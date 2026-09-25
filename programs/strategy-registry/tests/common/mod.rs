//! Shared helpers for the program tests: a funded publisher, instruction
//! builders, error extraction and a canonical JSON writer that reproduces
//! `@markov/strategy`'s manifest encoding byte for byte.
#![allow(dead_code)]
// Anchor 0.31 re-exports the solana-program modules under their old names.
#![allow(deprecated)]

use anchor_lang::{
    solana_program::{
        account_info::AccountInfo, entrypoint::ProgramResult, system_instruction, system_program,
    },
    AccountDeserialize, InstructionData, ToAccountMetas,
};
use markov_strategy_registry::{
    accounts, instruction, Leg, RegisterVersionArgs, VersionRecord, ID, RECORD_SEED,
};
use sha2::{Digest, Sha256};
use solana_program_test::{processor, BanksClientError, ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::Account,
    instruction::{Instruction, InstructionError},
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::{Transaction, TransactionError},
};
use std::collections::BTreeMap;

pub const LAMPORTS_PER_SOL: u64 = 1_000_000_000;

/// Adapts Anchor's `entry` (one lifetime for every reference) to the
/// runtime's `ProcessInstruction` signature (independent lifetimes). The
/// runtime keeps the program id, the accounts and the data alive for the
/// whole synchronous call and nothing escapes it, so unifying the lifetimes
/// for the duration of the call cannot create a dangling reference. Test
/// harness only; the deployed program uses Anchor's own entrypoint.
fn entry_adapter<'a, 'b, 'c, 'd>(
    program_id: &'a Pubkey,
    accounts: &'b [AccountInfo<'c>],
    data: &'d [u8],
) -> ProgramResult {
    // SAFETY: see above; every reference outlives this call.
    let program_id: &'c Pubkey = unsafe { std::mem::transmute(program_id) };
    let accounts: &'c [AccountInfo<'c>] = unsafe { std::mem::transmute(accounts) };
    let data: &'c [u8] = unsafe { std::mem::transmute(data) };
    markov_strategy_registry::entry(program_id, accounts, data)
}

pub async fn start() -> (ProgramTestContext, Keypair) {
    let publisher = Keypair::new();
    let (context, _) = start_with_publisher(publisher.insecure_clone()).await;
    (context, publisher)
}

/// Move lamports from the test payer to `to`.
pub async fn transfer(context: &mut ProgramTestContext, to: &Pubkey, lamports: u64) {
    let blockhash = context.banks_client.get_latest_blockhash().await.unwrap();
    let payer = context.payer.insecure_clone();
    let transaction = Transaction::new_signed_with_payer(
        &[system_instruction::transfer(&payer.pubkey(), to, lamports)],
        Some(&payer.pubkey()),
        &[&payer],
        blockhash,
    );
    context
        .banks_client
        .process_transaction(transaction)
        .await
        .expect("transfer succeeds");
}

pub async fn start_with_publisher(publisher: Keypair) -> (ProgramTestContext, Keypair) {
    let mut program_test =
        ProgramTest::new("markov_strategy_registry", ID, processor!(entry_adapter));
    program_test.add_account(
        publisher.pubkey(),
        Account {
            lamports: 10 * LAMPORTS_PER_SOL,
            data: vec![],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    let context = program_test.start_with_context().await;
    (context, publisher)
}

pub fn record_pda(manifest_hash: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[RECORD_SEED, manifest_hash.as_ref()], &ID)
}

pub fn register_instruction(
    publisher: &Pubkey,
    args: &RegisterVersionArgs,
    parent_record: Option<Pubkey>,
) -> Instruction {
    let (record, _) = record_pda(&args.manifest_hash);
    Instruction {
        program_id: ID,
        accounts: accounts::RegisterVersion {
            publisher: *publisher,
            record,
            parent_record,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: instruction::RegisterVersion { args: args.clone() }.data(),
    }
}

pub fn set_status_instruction(publisher: &Pubkey, record: &Pubkey, status: u8) -> Instruction {
    Instruction {
        program_id: ID,
        accounts: accounts::SetStatus {
            publisher: *publisher,
            record: *record,
        }
        .to_account_metas(None),
        data: instruction::SetStatus { status }.data(),
    }
}

/// Send instructions paid for and signed by `signers[0]`.
pub async fn send(
    context: &mut ProgramTestContext,
    instructions: &[Instruction],
    signers: &[&Keypair],
) -> Result<(), BanksClientError> {
    let blockhash = context.banks_client.get_latest_blockhash().await?;
    let transaction = Transaction::new_signed_with_payer(
        instructions,
        Some(&signers[0].pubkey()),
        signers,
        blockhash,
    );
    context.banks_client.process_transaction(transaction).await
}

/// The custom program error code of a failed transaction, if that is what failed.
pub fn custom_code(error: &BanksClientError) -> Option<u32> {
    match error {
        BanksClientError::TransactionError(TransactionError::InstructionError(
            _,
            InstructionError::Custom(code),
        ))
        | BanksClientError::SimulationError {
            err: TransactionError::InstructionError(_, InstructionError::Custom(code)),
            ..
        } => Some(*code),
        _ => None,
    }
}

pub async fn account_data(context: &mut ProgramTestContext, address: &Pubkey) -> Option<Vec<u8>> {
    context
        .banks_client
        .get_account(*address)
        .await
        .expect("banks client")
        .map(|account| account.data)
}

pub async fn read_record(context: &mut ProgramTestContext, address: &Pubkey) -> VersionRecord {
    let data = account_data(context, address).await.expect("record exists");
    VersionRecord::try_deserialize(&mut data.as_slice()).expect("record decodes")
}

pub fn hash32(label: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    out.copy_from_slice(&Sha256::digest(label.as_bytes()));
    out
}

pub fn leg(mint: Pubkey, token_program: Pubkey, weight_bps: u16) -> Leg {
    Leg {
        mint,
        token_program,
        weight_bps,
    }
}

/// Legs sorted ascending by mint, as the program requires.
pub fn sorted(mut legs: Vec<Leg>) -> Vec<Leg> {
    legs.sort_by(|a, b| a.mint.cmp(&b.mint));
    legs
}

/* --------------------------------------------------------- canonical JSON */

/// A JSON value with object keys kept sorted; the writer emits exactly what
/// `JSON.stringify` produces for the same value (no whitespace, the same
/// string escapes).
#[derive(Clone, Debug)]
pub enum Json {
    Null,
    Bool(bool),
    Int(i64),
    Str(String),
    Arr(Vec<Json>),
    Obj(BTreeMap<String, Json>),
}

impl Json {
    pub fn obj(entries: Vec<(&str, Json)>) -> Json {
        Json::Obj(
            entries
                .into_iter()
                .map(|(k, v)| (k.to_string(), v))
                .collect(),
        )
    }

    pub fn str(value: &str) -> Json {
        Json::Str(value.to_string())
    }
}

fn escape(text: &str, out: &mut String) {
    out.push('"');
    for ch in text.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

pub fn write_json(value: &Json, out: &mut String) {
    match value {
        Json::Null => out.push_str("null"),
        Json::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Json::Int(i) => out.push_str(&i.to_string()),
        Json::Str(s) => escape(s, out),
        Json::Arr(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_json(item, out);
            }
            out.push(']');
        }
        Json::Obj(entries) => {
            out.push('{');
            for (index, (key, item)) in entries.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                escape(key, out);
                out.push(':');
                write_json(item, out);
            }
            out.push('}');
        }
    }
}

pub fn canonical(value: &Json) -> String {
    let mut out = String::new();
    write_json(value, &mut out);
    out
}

/// A manifest leg as the off-chain manifest names it.
pub struct ManifestLeg<'a> {
    pub instrument_id: &'a str,
    pub mint: &'a str,
    pub token_program: &'a str,
    pub weight_bps: i64,
}

pub struct ManifestInput<'a> {
    pub genesis_hash: &'a str,
    pub strategy_id: &'a str,
    pub version_number: i64,
    pub parent_version_id: Option<&'a str>,
    pub fork_of: Option<(&'a str, &'a str)>,
    pub title: &'a str,
    pub thesis: &'a str,
    pub thesis_id: Option<&'a str>,
    pub legs: Vec<ManifestLeg<'a>>,
    pub cash_weight_bps: i64,
    pub references: Vec<&'a str>,
}

fn content_entries(input: &ManifestInput) -> Vec<(&'static str, Json)> {
    let mut legs: Vec<&ManifestLeg> = input.legs.iter().collect();
    legs.sort_by(|a, b| a.instrument_id.cmp(b.instrument_id));
    let mut references: Vec<&str> = input.references.clone();
    references.sort();
    vec![
        ("schemaVersion", Json::str("1")),
        ("kind", Json::str("stock_spot_basket")),
        (
            "network",
            Json::obj(vec![
                ("chain", Json::str("solana")),
                ("genesisHash", Json::str(input.genesis_hash)),
            ]),
        ),
        ("title", Json::str(input.title)),
        ("thesis", Json::str(input.thesis)),
        (
            "thesisId",
            input.thesis_id.map(Json::str).unwrap_or(Json::Null),
        ),
        (
            "legs",
            Json::Arr(
                legs.iter()
                    .map(|leg| {
                        Json::obj(vec![
                            ("instrumentId", Json::str(leg.instrument_id)),
                            ("mint", Json::str(leg.mint)),
                            ("tokenProgram", Json::str(leg.token_program)),
                            ("weightBps", Json::Int(leg.weight_bps)),
                        ])
                    })
                    .collect(),
            ),
        ),
        ("cashWeightBps", Json::Int(input.cash_weight_bps)),
        (
            "maintenance",
            Json::obj(vec![
                ("suggestion", Json::str("hold")),
                ("driftThresholdBps", Json::Null),
                ("reviewEveryDays", Json::Null),
            ]),
        ),
        (
            "references",
            Json::Arr(references.iter().map(|r| Json::str(r)).collect()),
        ),
    ]
}

/// `canonicalContent` of `@markov/strategy`.
pub fn canonical_content(input: &ManifestInput) -> String {
    canonical(&Json::obj(content_entries(input)))
}

/// `canonicalManifest` of `@markov/strategy`: the content plus its lineage.
pub fn canonical_manifest(input: &ManifestInput) -> String {
    let mut entries = content_entries(input);
    entries.push(("strategyId", Json::str(input.strategy_id)));
    entries.push(("versionNumber", Json::Int(input.version_number)));
    entries.push((
        "parentVersionId",
        input.parent_version_id.map(Json::str).unwrap_or(Json::Null),
    ));
    entries.push((
        "forkOf",
        input
            .fork_of
            .map(|(s, v)| {
                Json::obj(vec![
                    ("strategyId", Json::str(s)),
                    ("versionId", Json::str(v)),
                ])
            })
            .unwrap_or(Json::Null),
    ));
    canonical(&Json::obj(entries))
}

fn domain_hash(domain: &str, canonical: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(domain.as_bytes());
    hasher.update(b"\n");
    hasher.update(canonical.as_bytes());
    let mut out = [0u8; 32];
    out.copy_from_slice(&hasher.finalize());
    out
}

pub fn manifest_hash(canonical: &str, genesis_hash: &str) -> [u8; 32] {
    domain_hash(
        &format!("markov-strategy-manifest/v1/{genesis_hash}"),
        canonical,
    )
}

pub fn content_digest(canonical: &str, genesis_hash: &str) -> [u8; 32] {
    domain_hash(
        &format!("markov-strategy-content/v1/{genesis_hash}"),
        canonical,
    )
}
