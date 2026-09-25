//! Shared test vectors for the TypeScript SDK (`@markov/registry`): the
//! B07 manifest hash reproduced from the canonical JSON, the exact
//! instruction bytes, the program-derived record address, the account
//! bytes the runtime writes at a fixed clock, and a set of program-address
//! derivations. Run with `MARKOV_WRITE_VECTORS=1` to regenerate
//! `vectors/registry-vectors.json`; without it the test asserts the file is
//! current.
#![allow(deprecated)]
mod common;

use anchor_lang::Discriminator;
use common::*;
use markov_strategy_registry::{
    instruction, Leg, RegisterVersionArgs, RegistryError, VersionRecord, ID, MAX_LEGS, RECORD_SEED,
    RECORD_SPACE, RELATION_NONE, SPL_TOKEN_PROGRAM_ID, STATUS_DEPRECATED, TOKEN_2022_PROGRAM_ID,
};
use serde_json::{json, Value};
use solana_program_test::tokio;
use solana_sdk::{
    clock::Clock,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
};
use std::{fs, path::PathBuf};

const DEVNET_GENESIS: &str = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
/// Synthetic fixture mints (packages/issuer-prestocks/fixtures/fixture-mints.json).
const FXAERO_MINT: &str = "62DEN6DTG3vrmCVKAwHsdjpmWM3u4esQjxmppUcXxnfv";
const FXBIO_MINT: &str = "89JBaNKMcbL54KJB6scYRgrRm8GhaEtvfpeTqtvBDWnL";

fn vectors_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vectors/registry-vectors.json")
}

fn hex32(bytes: &[u8; 32]) -> String {
    hex::encode(bytes)
}

fn leg_json(leg: &Leg) -> Value {
    json!({
        "mint": leg.mint.to_string(),
        "tokenProgram": leg.token_program.to_string(),
        "weightBps": leg.weight_bps,
    })
}

fn record_json(record: &VersionRecord) -> Value {
    json!({
        "layoutVersion": record.layout_version,
        "schemaVersion": record.schema_version,
        "status": record.status,
        "bump": record.bump,
        "publisher": record.publisher.to_string(),
        "manifestHash": hex32(&record.manifest_hash),
        "contentDigest": hex32(&record.content_digest),
        "relation": record.relation,
        "parentManifestHash": hex32(&record.parent_manifest_hash),
        "cashWeightBps": record.cash_weight_bps,
        "legs": record.legs.iter().map(leg_json).collect::<Vec<_>>(),
        "registeredSlot": record.registered_slot,
        "registeredUnixTime": record.registered_unix_time,
        "statusUpdatedSlot": record.status_updated_slot,
    })
}

const ERRORS: [(RegistryError, &str, &str); 13] = [
    (
        RegistryError::UnsupportedSchema,
        "UnsupportedSchema",
        "unsupported manifest schema version",
    ),
    (
        RegistryError::EmptyHash,
        "EmptyHash",
        "a hash must not be all zeros",
    ),
    (
        RegistryError::NoLegs,
        "NoLegs",
        "a version needs at least one leg",
    ),
    (
        RegistryError::TooManyLegs,
        "TooManyLegs",
        "more legs than the registry accepts",
    ),
    (
        RegistryError::ZeroWeight,
        "ZeroWeight",
        "a leg weight must be at least 1 basis point",
    ),
    (
        RegistryError::InvalidMint,
        "InvalidMint",
        "a leg mint must not be the default public key",
    ),
    (
        RegistryError::UnsupportedTokenProgram,
        "UnsupportedTokenProgram",
        "only SPL Token and Token-2022 mints are supported",
    ),
    (
        RegistryError::LegsNotSorted,
        "LegsNotSorted",
        "legs must be strictly ascending by mint",
    ),
    (
        RegistryError::WeightTotal,
        "WeightTotal",
        "leg weights plus cash must equal exactly 10,000 basis points",
    ),
    (
        RegistryError::UnknownRelation,
        "UnknownRelation",
        "unknown relation",
    ),
    (
        RegistryError::InvalidParent,
        "InvalidParent",
        "parent reference does not match the relation",
    ),
    (
        RegistryError::UnknownStatus,
        "UnknownStatus",
        "unknown status",
    ),
    (
        RegistryError::NotPublisher,
        "NotPublisher",
        "only the publisher may change the status",
    ),
];

#[tokio::test]
async fn vectors_are_current() {
    // 1. The B07 manifest vector reproduced from canonical JSON.
    let b07 = ManifestInput {
        genesis_hash: DEVNET_GENESIS,
        strategy_id: "55555555-5555-4555-8555-555555555555",
        version_number: 1,
        parent_version_id: None,
        fork_of: None,
        title: "Aerospace tilt",
        thesis: "Launch cadence is underestimated.",
        thesis_id: None,
        legs: vec![
            ManifestLeg {
                instrument_id: "33333333-3333-4333-8333-333333333333",
                mint: "M3",
                token_program: "token-2022",
                weight_bps: 3000,
            },
            ManifestLeg {
                instrument_id: "11111111-1111-4111-8111-111111111111",
                mint: "M1",
                token_program: "spl-token",
                weight_bps: 3000,
            },
            ManifestLeg {
                instrument_id: "22222222-2222-4222-8222-222222222222",
                mint: "M2",
                token_program: "token-2022",
                weight_bps: 2000,
            },
        ],
        cash_weight_bps: 2000,
        references: vec!["https://b.example.com/x", "https://a.example.com/y"],
    };
    let b07_manifest = canonical_manifest(&b07);
    let b07_content = canonical_content(&b07);
    let b07_hash = manifest_hash(&b07_manifest, DEVNET_GENESIS);
    let b07_digest = content_digest(&b07_content, DEVNET_GENESIS);
    assert_eq!(
        hex32(&b07_hash),
        "d324b072007fd7af46659406f5bb90b373ef088bc19774b99a726d9a95dacc1a",
        "B07 manifest hash vector"
    );
    assert_eq!(
        hex32(&b07_digest),
        "910207cf06da18bcbf497381e9ac8f209e8c0ab895c1ae011bf36390102e0819",
        "B07 content digest vector"
    );

    // 2. A registrable manifest with the synthetic fixture mints.
    let registration = ManifestInput {
        genesis_hash: DEVNET_GENESIS,
        strategy_id: "55555555-5555-4555-8555-555555555555",
        version_number: 1,
        parent_version_id: None,
        fork_of: None,
        title: "Aerospace tilt",
        thesis: "Launch cadence is underestimated.",
        thesis_id: None,
        legs: vec![
            ManifestLeg {
                instrument_id: "11111111-1111-4111-8111-111111111111",
                mint: FXAERO_MINT,
                token_program: "spl-token",
                weight_bps: 6000,
            },
            ManifestLeg {
                instrument_id: "22222222-2222-4222-8222-222222222222",
                mint: FXBIO_MINT,
                token_program: "token-2022",
                weight_bps: 3000,
            },
        ],
        cash_weight_bps: 1000,
        references: vec![],
    };
    let reg_manifest = canonical_manifest(&registration);
    let reg_content = canonical_content(&registration);
    let reg_hash = manifest_hash(&reg_manifest, DEVNET_GENESIS);
    let reg_digest = content_digest(&reg_content, DEVNET_GENESIS);
    let args = RegisterVersionArgs {
        schema_version: 1,
        manifest_hash: reg_hash,
        content_digest: reg_digest,
        relation: RELATION_NONE,
        parent_manifest_hash: [0u8; 32],
        cash_weight_bps: 1000,
        legs: sorted(vec![
            leg(FXAERO_MINT.parse().unwrap(), SPL_TOKEN_PROGRAM_ID, 6000),
            leg(FXBIO_MINT.parse().unwrap(), TOKEN_2022_PROGRAM_ID, 3000),
        ]),
    };

    // 3. Register it under the runtime at a fixed clock with a deterministic publisher.
    let publisher = Keypair::new_from_array(hash32("markov-registry-vector-publisher"));
    let (mut context, publisher) = start_with_publisher(publisher).await;
    let clock = Clock {
        slot: 4242,
        epoch_start_timestamp: 1_758_800_000,
        epoch: 0,
        leader_schedule_epoch: 1,
        unix_timestamp: 1_758_800_123,
    };
    context.set_sysvar(&clock);
    let instruction_ = register_instruction(&publisher.pubkey(), &args, None);
    send(
        &mut context,
        std::slice::from_ref(&instruction_),
        &[&publisher],
    )
    .await
    .expect("registers");
    let (record_address, bump) = record_pda(&reg_hash);
    let record_data = account_data(&mut context, &record_address).await.unwrap();
    assert_eq!(record_data.len(), RECORD_SPACE);
    let record = read_record(&mut context, &record_address).await;

    // 4. Deprecate at a later, fixed slot.
    context.warp_to_slot(5000).unwrap();
    let later = Clock {
        slot: 5000,
        epoch_start_timestamp: 1_758_800_000,
        epoch: 0,
        leader_schedule_epoch: 1,
        unix_timestamp: 1_758_800_456,
    };
    context.set_sysvar(&later);
    let deprecate = set_status_instruction(&publisher.pubkey(), &record_address, STATUS_DEPRECATED);
    send(
        &mut context,
        std::slice::from_ref(&deprecate),
        &[&publisher],
    )
    .await
    .expect("deprecates");
    let deprecated_data = account_data(&mut context, &record_address).await.unwrap();
    let deprecated = read_record(&mut context, &record_address).await;
    assert_eq!(deprecated.status, STATUS_DEPRECATED);
    assert_eq!(deprecated.status_updated_slot, 5000);

    // 5. Program-address derivations for the TypeScript implementation.
    let derivations: Vec<Value> = [
        vec![RECORD_SEED.to_vec(), reg_hash.to_vec()],
        vec![RECORD_SEED.to_vec(), b07_hash.to_vec()],
        vec![RECORD_SEED.to_vec(), [0u8; 32].to_vec()],
        vec![b"markov".to_vec()],
        vec![b"a".to_vec(), b"b".to_vec(), vec![1, 2, 3]],
    ]
    .into_iter()
    .map(|seeds| {
        let seed_refs: Vec<&[u8]> = seeds.iter().map(|s| s.as_slice()).collect();
        let (address, bump) = Pubkey::find_program_address(&seed_refs, &ID);
        json!({
            "seeds": seeds.iter().map(hex::encode).collect::<Vec<_>>(),
            "address": address.to_string(),
            "bump": bump,
        })
    })
    .collect();

    let document = json!({
        "programId": ID.to_string(),
        "recordSeed": String::from_utf8(RECORD_SEED.to_vec()).unwrap(),
        "recordSpace": RECORD_SPACE,
        "maxLegs": MAX_LEGS,
        "tokenPrograms": {
            "spl-token": SPL_TOKEN_PROGRAM_ID.to_string(),
            "token-2022": TOKEN_2022_PROGRAM_ID.to_string(),
        },
        "discriminators": {
            "register_version": hex::encode(<instruction::RegisterVersion as Discriminator>::DISCRIMINATOR),
            "set_status": hex::encode(<instruction::SetStatus as Discriminator>::DISCRIMINATOR),
            "VersionRecord": hex::encode(<VersionRecord as Discriminator>::DISCRIMINATOR),
        },
        "errors": ERRORS.iter().map(|(error, name, message)| json!({
            "name": name,
            "code": 6000 + *error as u32,
            "message": message,
        })).collect::<Vec<_>>(),
        "manifest": {
            "b07": {
                "canonicalManifest": b07_manifest,
                "manifestHash": hex32(&b07_hash),
                "canonicalContent": b07_content,
                "contentDigest": hex32(&b07_digest),
            }
        },
        "registration": {
            "genesisHash": DEVNET_GENESIS,
            "manifest": {
                "strategyId": registration.strategy_id,
                "versionNumber": registration.version_number,
                "parentVersionId": Value::Null,
                "forkOf": Value::Null,
                "title": registration.title,
                "thesis": registration.thesis,
                "thesisId": Value::Null,
                "legs": registration.legs.iter().map(|l| json!({
                    "instrumentId": l.instrument_id,
                    "mint": l.mint,
                    "tokenProgram": l.token_program,
                    "weightBps": l.weight_bps,
                })).collect::<Vec<_>>(),
                "cashWeightBps": registration.cash_weight_bps,
                "maintenance": { "suggestion": "hold", "driftThresholdBps": Value::Null, "reviewEveryDays": Value::Null },
                "references": Vec::<String>::new(),
            },
            "canonicalManifest": reg_manifest,
            "manifestHash": hex32(&reg_hash),
            "canonicalContent": reg_content,
            "contentDigest": hex32(&reg_digest),
            "args": {
                "schemaVersion": args.schema_version,
                "manifestHash": hex32(&args.manifest_hash),
                "contentDigest": hex32(&args.content_digest),
                "relation": args.relation,
                "parentManifestHash": hex32(&args.parent_manifest_hash),
                "cashWeightBps": args.cash_weight_bps,
                "legs": args.legs.iter().map(leg_json).collect::<Vec<_>>(),
            },
            "instructionData": hex::encode(&instruction_.data),
            "accounts": instruction_.accounts.iter().map(|meta| json!({
                "pubkey": meta.pubkey.to_string(),
                "isSigner": meta.is_signer,
                "isWritable": meta.is_writable,
            })).collect::<Vec<_>>(),
            "publisher": publisher.pubkey().to_string(),
            "recordAddress": record_address.to_string(),
            "bump": bump,
            "clock": { "slot": clock.slot, "unixTimestamp": clock.unix_timestamp },
            "recordData": hex::encode(&record_data),
            "record": record_json(&record),
        },
        "deprecation": {
            "instructionData": hex::encode(&deprecate.data),
            "accounts": deprecate.accounts.iter().map(|meta| json!({
                "pubkey": meta.pubkey.to_string(),
                "isSigner": meta.is_signer,
                "isWritable": meta.is_writable,
            })).collect::<Vec<_>>(),
            "clock": { "slot": later.slot, "unixTimestamp": later.unix_timestamp },
            "recordData": hex::encode(&deprecated_data),
            "record": record_json(&deprecated),
        },
        "programAddresses": derivations,
    });
    let rendered = format!("{}\n", serde_json::to_string_pretty(&document).unwrap());

    let path = vectors_path();
    if std::env::var("MARKOV_WRITE_VECTORS").is_ok() {
        fs::write(&path, &rendered).unwrap();
        return;
    }
    let existing = fs::read_to_string(&path).unwrap_or_default();
    assert_eq!(
        existing, rendered,
        "vectors/registry-vectors.json is stale; regenerate with MARKOV_WRITE_VECTORS=1 cargo test"
    );
}
