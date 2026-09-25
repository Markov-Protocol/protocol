//! Behaviour of the registry program under the real runtime
//! (`solana-program-test`, native processor): registration evidence,
//! unauthorized publishing, seed and account misuse, weight overflow,
//! duplicate initialisation and immutable-content protection.
#![allow(deprecated)]
mod common;

use anchor_lang::solana_program::system_program;
use common::*;
use markov_strategy_registry::{
    check_register_args, Leg, RegisterVersionArgs, RegistryError, ID, RECORD_LAYOUT_VERSION,
    RECORD_SPACE, RELATION_FORK, RELATION_NONE, RELATION_REVISION, SPL_TOKEN_PROGRAM_ID,
    STATUS_ACTIVE, STATUS_DEPRECATED, TOKEN_2022_PROGRAM_ID,
};
use solana_program_test::tokio;
use solana_sdk::{
    clock::Clock,
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::{Keypair, Signer},
};

/// Anchor framework error codes this program relies on (`has_one` is
/// mapped to the program's own `NotPublisher`).
const ANCHOR_CONSTRAINT_SEEDS: u32 = 2006;
const ANCHOR_ACCOUNT_DISCRIMINATOR_MISMATCH: u32 = 3002;
const ANCHOR_ACCOUNT_OWNED_BY_WRONG_PROGRAM: u32 = 3007;
const ANCHOR_INVALID_PROGRAM_ID: u32 = 3008;
const ANCHOR_ACCOUNT_NOT_SIGNER: u32 = 3010;
const ANCHOR_ACCOUNT_NOT_INITIALIZED: u32 = 3012;

fn err_code(error: RegistryError) -> u32 {
    6000 + error as u32
}

/// Bytes a record occupies before its zero padding: discriminator, fixed
/// fields, the leg vector (u32 length + 66 bytes per leg) and three u64s.
fn record_body_len(legs: usize) -> usize {
    8 + (1 + 2 + 1 + 1 + 32 + 32 + 32 + 1 + 32 + 2) + 4 + legs * 66 + 8 + 8 + 8
}

fn mint(label: &str) -> Pubkey {
    Pubkey::new_from_array(hash32(label))
}

fn two_legs() -> Vec<Leg> {
    sorted(vec![
        leg(mint("mint-a"), SPL_TOKEN_PROGRAM_ID, 6000),
        leg(mint("mint-b"), TOKEN_2022_PROGRAM_ID, 3000),
    ])
}

fn args(label: &str, legs: Vec<Leg>, cash_weight_bps: u16) -> RegisterVersionArgs {
    RegisterVersionArgs {
        schema_version: 1,
        manifest_hash: hash32(&format!("manifest:{label}")),
        content_digest: hash32(&format!("content:{label}")),
        relation: RELATION_NONE,
        parent_manifest_hash: [0u8; 32],
        cash_weight_bps,
        legs,
    }
}

#[tokio::test]
async fn registers_a_version_with_clock_evidence_and_rent_exempt_space() {
    let (mut context, publisher) = start().await;
    let clock = Clock {
        slot: 4242,
        epoch_start_timestamp: 1_758_800_000,
        epoch: 0,
        leader_schedule_epoch: 1,
        unix_timestamp: 1_758_800_123,
    };
    context.set_sysvar(&clock);
    let a = args("v1", two_legs(), 1000);
    send(
        &mut context,
        &[register_instruction(&publisher.pubkey(), &a, None)],
        &[&publisher],
    )
    .await
    .expect("registration succeeds");

    let (record_address, bump) = record_pda(&a.manifest_hash);
    let account = context
        .banks_client
        .get_account(record_address)
        .await
        .unwrap()
        .expect("record account exists");
    assert_eq!(account.owner, ID);
    assert_eq!(account.data.len(), RECORD_SPACE);
    let rent = context.banks_client.get_rent().await.unwrap();
    assert!(account.lamports >= rent.minimum_balance(RECORD_SPACE));

    let record = read_record(&mut context, &record_address).await;
    assert_eq!(record.layout_version, RECORD_LAYOUT_VERSION);
    assert_eq!(record.schema_version, 1);
    assert_eq!(record.status, STATUS_ACTIVE);
    assert_eq!(record.bump, bump);
    assert_eq!(record.publisher, publisher.pubkey());
    assert_eq!(record.manifest_hash, a.manifest_hash);
    assert_eq!(record.content_digest, a.content_digest);
    assert_eq!(record.relation, RELATION_NONE);
    assert_eq!(record.parent_manifest_hash, [0u8; 32]);
    assert_eq!(record.cash_weight_bps, 1000);
    assert_eq!(record.legs, a.legs);
    assert_eq!(record.registered_slot, 4242);
    assert_eq!(record.registered_unix_time, 1_758_800_123);
    assert_eq!(record.status_updated_slot, 4242);
}

#[tokio::test]
async fn duplicate_initialisation_is_refused_and_the_record_is_byte_identical() {
    let (mut context, publisher) = start().await;
    let first = args("dup", two_legs(), 1000);
    send(
        &mut context,
        &[register_instruction(&publisher.pubkey(), &first, None)],
        &[&publisher],
    )
    .await
    .unwrap();
    let (record_address, _) = record_pda(&first.manifest_hash);
    let before = account_data(&mut context, &record_address).await.unwrap();

    // Same manifest hash (same PDA), different economic content, same publisher.
    let mut again = args(
        "dup",
        vec![leg(mint("mint-z"), SPL_TOKEN_PROGRAM_ID, 10_000)],
        0,
    );
    again.content_digest = hash32("content:other");
    let error = send(
        &mut context,
        &[register_instruction(&publisher.pubkey(), &again, None)],
        &[&publisher],
    )
    .await
    .expect_err("a second initialisation must fail");
    assert!(
        custom_code(&error).is_some(),
        "expected a program error, got {error:?}"
    );

    // Another wallet cannot take the record over either.
    let stranger = Keypair::new();
    transfer(&mut context, &stranger.pubkey(), LAMPORTS_PER_SOL).await;
    send(
        &mut context,
        &[register_instruction(&stranger.pubkey(), &first, None)],
        &[&stranger],
    )
    .await
    .expect_err("a stranger cannot re-initialise the record");

    let after = account_data(&mut context, &record_address).await.unwrap();
    assert_eq!(before, after, "the record bytes never change");
}

#[tokio::test]
async fn unauthorized_publishing_is_refused() {
    let (mut context, publisher) = start().await;
    let a = args("unauth", two_legs(), 1000);
    let payer = Keypair::new();
    transfer(&mut context, &payer.pubkey(), LAMPORTS_PER_SOL).await;

    // The publisher account is passed without its signature.
    let mut instruction = register_instruction(&publisher.pubkey(), &a, None);
    instruction.accounts[0] = AccountMeta::new(publisher.pubkey(), false);
    let error = send(&mut context, &[instruction], &[&payer])
        .await
        .expect_err("must fail");
    assert_eq!(custom_code(&error), Some(ANCHOR_ACCOUNT_NOT_SIGNER));
    let (record_address, _) = record_pda(&a.manifest_hash);
    assert!(account_data(&mut context, &record_address).await.is_none());

    // A registered record's status is the publisher's alone.
    send(
        &mut context,
        &[register_instruction(&publisher.pubkey(), &a, None)],
        &[&publisher],
    )
    .await
    .unwrap();
    let error = send(
        &mut context,
        &[set_status_instruction(
            &payer.pubkey(),
            &record_address,
            STATUS_DEPRECATED,
        )],
        &[&payer],
    )
    .await
    .expect_err("a stranger cannot deprecate");
    assert_eq!(
        custom_code(&error),
        Some(err_code(RegistryError::NotPublisher))
    );
    assert_eq!(
        read_record(&mut context, &record_address).await.status,
        STATUS_ACTIVE
    );
}

#[tokio::test]
async fn seed_and_account_misuse_is_refused() {
    let (mut context, publisher) = start().await;
    let a = args("misuse", two_legs(), 1000);
    let other = args("misuse-other", two_legs(), 1000);
    let (wrong_pda, _) = record_pda(&other.manifest_hash);

    let with_record = |record: Pubkey| {
        let mut instruction = register_instruction(&publisher.pubkey(), &a, None);
        instruction.accounts[1] = AccountMeta::new(record, false);
        instruction
    };

    // Record derived from another manifest hash.
    let error = send(&mut context, &[with_record(wrong_pda)], &[&publisher])
        .await
        .unwrap_err();
    assert_eq!(custom_code(&error), Some(ANCHOR_CONSTRAINT_SEEDS));

    // Record that is a plain keypair account rather than the PDA.
    let error = send(
        &mut context,
        &[with_record(Pubkey::new_unique())],
        &[&publisher],
    )
    .await
    .unwrap_err();
    assert_eq!(custom_code(&error), Some(ANCHOR_CONSTRAINT_SEEDS));

    // Wrong system program.
    let mut instruction = register_instruction(&publisher.pubkey(), &a, None);
    instruction.accounts[3] = AccountMeta::new_readonly(Pubkey::new_unique(), false);
    let error = send(&mut context, &[instruction], &[&publisher])
        .await
        .unwrap_err();
    assert_eq!(custom_code(&error), Some(ANCHOR_INVALID_PROGRAM_ID));

    // A parent account passed for a relation that has none.
    let (pda_a, _) = record_pda(&a.manifest_hash);
    let error = send(
        &mut context,
        &[register_instruction(&publisher.pubkey(), &a, Some(pda_a))],
        &[&publisher],
    )
    .await
    .unwrap_err();
    assert!(custom_code(&error).is_some());
    assert!(account_data(&mut context, &pda_a).await.is_none());

    // Revision relation without a parent account.
    let mut revision = args("misuse-rev", two_legs(), 1000);
    revision.relation = RELATION_REVISION;
    revision.parent_manifest_hash = a.manifest_hash;
    let error = send(
        &mut context,
        &[register_instruction(&publisher.pubkey(), &revision, None)],
        &[&publisher],
    )
    .await
    .unwrap_err();
    assert_eq!(
        custom_code(&error),
        Some(err_code(RegistryError::InvalidParent))
    );

    // Parent account that is not a record (system-owned wallet).
    let error = send(
        &mut context,
        &[register_instruction(
            &publisher.pubkey(),
            &revision,
            Some(publisher.pubkey()),
        )],
        &[&publisher],
    )
    .await
    .unwrap_err();
    assert!(matches!(
        custom_code(&error),
        Some(ANCHOR_ACCOUNT_OWNED_BY_WRONG_PROGRAM)
            | Some(ANCHOR_ACCOUNT_NOT_INITIALIZED)
            | Some(ANCHOR_ACCOUNT_DISCRIMINATOR_MISMATCH)
    ));

    // Register the parent, then reference it with the wrong hash.
    send(
        &mut context,
        &[register_instruction(&publisher.pubkey(), &a, None)],
        &[&publisher],
    )
    .await
    .unwrap();
    let mut mismatched = revision.clone();
    mismatched.parent_manifest_hash = other.manifest_hash;
    let error = send(
        &mut context,
        &[register_instruction(
            &publisher.pubkey(),
            &mismatched,
            Some(pda_a),
        )],
        &[&publisher],
    )
    .await
    .unwrap_err();
    assert_eq!(
        custom_code(&error),
        Some(err_code(RegistryError::InvalidParent))
    );

    // The instruction data must belong to this program: a stray instruction is rejected.
    let stray = Instruction {
        program_id: ID,
        accounts: vec![AccountMeta::new(publisher.pubkey(), true)],
        data: vec![1, 2, 3],
    };
    send(&mut context, &[stray], &[&publisher])
        .await
        .unwrap_err();
}

#[tokio::test]
async fn weight_and_input_rules_are_enforced() {
    let (mut context, publisher) = start().await;
    let refuse = |label: &str, legs: Vec<Leg>, cash: u16, expected: RegistryError| {
        let a = args(label, legs, cash);
        (a, err_code(expected))
    };
    let cases = vec![
        refuse("w-9999", two_legs(), 999, RegistryError::WeightTotal),
        refuse("w-10001", two_legs(), 1001, RegistryError::WeightTotal),
        refuse(
            "w-overflow",
            sorted(
                (0..10)
                    .map(|i| leg(mint(&format!("m{i}")), SPL_TOKEN_PROGRAM_ID, u16::MAX))
                    .collect(),
            ),
            u16::MAX,
            RegistryError::WeightTotal,
        ),
        refuse(
            "w-zero",
            sorted(vec![
                leg(mint("z1"), SPL_TOKEN_PROGRAM_ID, 10_000),
                leg(mint("z2"), SPL_TOKEN_PROGRAM_ID, 0),
            ]),
            0,
            RegistryError::ZeroWeight,
        ),
        refuse("no-legs", vec![], 10_000, RegistryError::NoLegs),
        refuse(
            "too-many",
            sorted(
                (0..11)
                    .map(|i| leg(mint(&format!("t{i}")), SPL_TOKEN_PROGRAM_ID, 900))
                    .collect(),
            ),
            100,
            RegistryError::TooManyLegs,
        ),
        refuse(
            "unsorted",
            {
                let mut legs = two_legs();
                legs.reverse();
                legs
            },
            1000,
            RegistryError::LegsNotSorted,
        ),
        refuse(
            "duplicate-mint",
            vec![
                leg(mint("d"), SPL_TOKEN_PROGRAM_ID, 5000),
                leg(mint("d"), TOKEN_2022_PROGRAM_ID, 5000),
            ],
            0,
            RegistryError::LegsNotSorted,
        ),
        refuse(
            "bad-program",
            vec![leg(mint("p"), Pubkey::new_unique(), 10_000)],
            0,
            RegistryError::UnsupportedTokenProgram,
        ),
        refuse(
            "default-mint",
            vec![leg(Pubkey::default(), SPL_TOKEN_PROGRAM_ID, 10_000)],
            0,
            RegistryError::InvalidMint,
        ),
    ];
    for (a, expected) in cases {
        assert_eq!(
            check_register_args(&a).err().map(|e| match e {
                anchor_lang::error::Error::AnchorError(inner) => inner.error_code_number,
                other => panic!("unexpected error kind {other:?}"),
            }),
            Some(expected),
            "pure check for {}",
            hex::encode(a.manifest_hash)
        );
        let error = send(
            &mut context,
            &[register_instruction(&publisher.pubkey(), &a, None)],
            &[&publisher],
        )
        .await
        .expect_err("must be refused on chain");
        assert_eq!(
            custom_code(&error),
            Some(expected),
            "on chain for {}",
            hex::encode(a.manifest_hash)
        );
        let (record_address, _) = record_pda(&a.manifest_hash);
        assert!(account_data(&mut context, &record_address).await.is_none());
    }

    let mut schema = args("schema", two_legs(), 1000);
    schema.schema_version = 2;
    let error = send(
        &mut context,
        &[register_instruction(&publisher.pubkey(), &schema, None)],
        &[&publisher],
    )
    .await
    .unwrap_err();
    assert_eq!(
        custom_code(&error),
        Some(err_code(RegistryError::UnsupportedSchema))
    );

    let mut empty = args("empty", two_legs(), 1000);
    empty.content_digest = [0u8; 32];
    let error = send(
        &mut context,
        &[register_instruction(&publisher.pubkey(), &empty, None)],
        &[&publisher],
    )
    .await
    .unwrap_err();
    assert_eq!(
        custom_code(&error),
        Some(err_code(RegistryError::EmptyHash))
    );

    let mut relation = args("relation", two_legs(), 1000);
    relation.relation = 3;
    relation.parent_manifest_hash = hash32("parent");
    let error = send(
        &mut context,
        &[register_instruction(&publisher.pubkey(), &relation, None)],
        &[&publisher],
    )
    .await
    .unwrap_err();
    assert_eq!(
        custom_code(&error),
        Some(err_code(RegistryError::UnknownRelation))
    );

    // Exactly 10 legs summing to 10,000 with cash 0 is the largest valid record.
    let full = args(
        "full",
        sorted(
            (0..10)
                .map(|i| leg(mint(&format!("f{i}")), SPL_TOKEN_PROGRAM_ID, 1000))
                .collect(),
        ),
        0,
    );
    send(
        &mut context,
        &[register_instruction(&publisher.pubkey(), &full, None)],
        &[&publisher],
    )
    .await
    .expect("ten legs fit");
    let (record_address, _) = record_pda(&full.manifest_hash);
    assert_eq!(
        read_record(&mut context, &record_address).await.legs.len(),
        10
    );
}

#[tokio::test]
async fn lineage_references_registered_parents_only() {
    let (mut context, publisher) = start().await;
    let v1 = args("lineage-v1", two_legs(), 1000);
    send(
        &mut context,
        &[register_instruction(&publisher.pubkey(), &v1, None)],
        &[&publisher],
    )
    .await
    .unwrap();
    let (pda_v1, _) = record_pda(&v1.manifest_hash);

    let mut v2 = args("lineage-v2", two_legs(), 1000);
    v2.relation = RELATION_REVISION;
    v2.parent_manifest_hash = v1.manifest_hash;
    send(
        &mut context,
        &[register_instruction(&publisher.pubkey(), &v2, Some(pda_v1))],
        &[&publisher],
    )
    .await
    .expect("revision with its registered parent");
    let (pda_v2, _) = record_pda(&v2.manifest_hash);
    let record = read_record(&mut context, &pda_v2).await;
    assert_eq!(record.relation, RELATION_REVISION);
    assert_eq!(record.parent_manifest_hash, v1.manifest_hash);

    // A fork by another creator references the same parent.
    let forker = Keypair::new();
    transfer(&mut context, &forker.pubkey(), LAMPORTS_PER_SOL).await;
    let mut fork = args("lineage-fork", two_legs(), 1000);
    fork.relation = RELATION_FORK;
    fork.parent_manifest_hash = v2.manifest_hash;
    send(
        &mut context,
        &[register_instruction(&forker.pubkey(), &fork, Some(pda_v2))],
        &[&forker],
    )
    .await
    .expect("fork with its registered parent");
    let (pda_fork, _) = record_pda(&fork.manifest_hash);
    let record = read_record(&mut context, &pda_fork).await;
    assert_eq!(record.publisher, forker.pubkey());
    assert_eq!(record.relation, RELATION_FORK);
    assert_eq!(record.parent_manifest_hash, v2.manifest_hash);

    // The parent record is untouched by children.
    let parent = read_record(&mut context, &pda_v1).await;
    assert_eq!(parent.relation, RELATION_NONE);
    assert_eq!(parent.status, STATUS_ACTIVE);
}

#[tokio::test]
async fn status_marker_changes_nothing_but_status_and_its_slot() {
    let (mut context, publisher) = start().await;
    let a = args("status", two_legs(), 1000);
    send(
        &mut context,
        &[register_instruction(&publisher.pubkey(), &a, None)],
        &[&publisher],
    )
    .await
    .unwrap();
    let (record_address, _) = record_pda(&a.manifest_hash);
    let before = account_data(&mut context, &record_address).await.unwrap();
    let registered = read_record(&mut context, &record_address).await;

    context
        .warp_to_slot(registered.registered_slot + 500)
        .unwrap();
    send(
        &mut context,
        &[set_status_instruction(
            &publisher.pubkey(),
            &record_address,
            STATUS_DEPRECATED,
        )],
        &[&publisher],
    )
    .await
    .expect("publisher deprecates");
    let after = account_data(&mut context, &record_address).await.unwrap();
    let deprecated = read_record(&mut context, &record_address).await;
    assert_eq!(deprecated.status, STATUS_DEPRECATED);
    assert!(deprecated.status_updated_slot > registered.status_updated_slot);
    assert_eq!(deprecated.registered_slot, registered.registered_slot);
    assert_eq!(deprecated.legs, registered.legs);
    assert_eq!(deprecated.manifest_hash, registered.manifest_hash);
    assert_eq!(deprecated.publisher, registered.publisher);

    // Only the status byte and the status slot differ.
    let differing: Vec<usize> = before
        .iter()
        .zip(after.iter())
        .enumerate()
        .filter(|(_, (a, b))| a != b)
        .map(|(index, _)| index)
        .collect();
    let status_offset = 8 + 1 + 2;
    let body_len = record_body_len(registered.legs.len());
    let status_slot = (body_len - 8)..body_len;
    assert!(
        differing.contains(&status_offset),
        "status byte changed: {differing:?}"
    );
    assert!(
        differing
            .iter()
            .all(|index| *index == status_offset || status_slot.contains(index)),
        "unexpected bytes changed: {differing:?}"
    );

    // Unknown status values are refused; the publisher may reactivate.
    let error = send(
        &mut context,
        &[set_status_instruction(
            &publisher.pubkey(),
            &record_address,
            2,
        )],
        &[&publisher],
    )
    .await
    .unwrap_err();
    assert_eq!(
        custom_code(&error),
        Some(err_code(RegistryError::UnknownStatus))
    );
    send(
        &mut context,
        &[set_status_instruction(
            &publisher.pubkey(),
            &record_address,
            STATUS_ACTIVE,
        )],
        &[&publisher],
    )
    .await
    .unwrap();
    assert_eq!(
        read_record(&mut context, &record_address).await.status,
        STATUS_ACTIVE
    );

    // A record of another manifest cannot be addressed through mismatched seeds.
    let other = args("status-other", two_legs(), 1000);
    send(
        &mut context,
        &[register_instruction(&publisher.pubkey(), &other, None)],
        &[&publisher],
    )
    .await
    .unwrap();
    let (other_address, _) = record_pda(&other.manifest_hash);
    let mut instruction =
        set_status_instruction(&publisher.pubkey(), &other_address, STATUS_DEPRECATED);
    instruction.accounts[1] = AccountMeta::new(system_program::ID, false);
    send(&mut context, &[instruction], &[&publisher])
        .await
        .unwrap_err();
}
