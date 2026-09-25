//! Markov strategy registry.
//!
//! A small noncustodial Solana program that records the recipe of a strategy
//! version as an immutable account: the leg mints and their token programs,
//! integer basis-point weights, the explicit cash weight, the manifest hash
//! and content digest computed off chain (`docs/markov/strategies.md`), an
//! optional reference to a registered parent record, and the slot and time
//! of registration. The program holds no tokens, performs no swaps, makes no
//! CPI other than the system program call that creates the record, extracts
//! no fee, creates no delegate and manages no keys. It records recipes; it
//! neither approves an issuer's legality nor guarantees execution.
//!
//! Records are derived from the manifest hash (`["version", manifest_hash]`),
//! so one recipe version can be registered exactly once and anyone holding a
//! manifest can locate and verify its record. The publisher's signature is
//! the only authority: the economic content can never be changed, and only
//! the publisher may later mark a record deprecated or active again. There
//! is no authority transfer and no operator override: a lost publisher key
//! leaves the record exactly as it was.
#![allow(unexpected_cfgs)]
// Anchor 0.31's generated account code uses `AccountInfo::realloc`, deprecated by solana-program 2.3.
#![allow(deprecated)]

use anchor_lang::prelude::*;

// Development placeholder. A deployment replaces it with the public key of
// its own program keypair before building (docs/markov/strategy-registry.md,
// "Deployment and review"); the secret of this placeholder was discarded.
declare_id!("6SAPG2iavaEAv628NpuZuSwgKxGhqU23C769w7FfGpuZ");

/// Seed prefix of a version record: `["version", manifest_hash]`.
pub const RECORD_SEED: &[u8] = b"version";
/// Product complexity limit shared with `MAX_STRATEGY_LEGS` in `@markov/contracts`.
pub const MAX_LEGS: usize = 10;
/// Leg weights plus the cash weight always equal exactly this.
pub const TOTAL_BPS: u32 = 10_000;
/// The only manifest schema version this program version accepts.
pub const SCHEMA_VERSION: u16 = 1;
/// Layout version written into every record; bumped only by a new program version.
pub const RECORD_LAYOUT_VERSION: u8 = 1;
/// Space of a record account including the 8-byte discriminator.
pub const RECORD_SPACE: usize = 8 + VersionRecord::INIT_SPACE;

pub const SPL_TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const TOKEN_2022_PROGRAM_ID: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/// `relation` values: how a record relates to `parent_manifest_hash`.
pub const RELATION_NONE: u8 = 0;
/// A later version of the same strategy.
pub const RELATION_REVISION: u8 = 1;
/// A fork of another creator's version.
pub const RELATION_FORK: u8 = 2;

/// `status` values.
pub const STATUS_ACTIVE: u8 = 0;
pub const STATUS_DEPRECATED: u8 = 1;

const _: () = assert!(
    MAX_LEGS == 10,
    "the #[max_len] on VersionRecord::legs must equal MAX_LEGS"
);

#[program]
pub mod markov_strategy_registry {
    use super::*;

    /// Register a version recipe under `["version", manifest_hash]`.
    ///
    /// The publisher signs and pays; the record is created by the system
    /// program and can never be initialised twice. Every rule in
    /// [`check_register_args`] must hold and, when `relation` is not
    /// `RELATION_NONE`, the registered parent record must be passed and carry
    /// `parent_manifest_hash`.
    pub fn register_version(
        ctx: Context<RegisterVersion>,
        args: RegisterVersionArgs,
    ) -> Result<()> {
        check_register_args(&args)?;
        match args.relation {
            RELATION_NONE => {
                require!(
                    ctx.accounts.parent_record.is_none(),
                    RegistryError::InvalidParent
                );
            }
            _ => {
                let parent = ctx
                    .accounts
                    .parent_record
                    .as_ref()
                    .ok_or(error!(RegistryError::InvalidParent))?;
                require!(
                    parent.manifest_hash == args.parent_manifest_hash,
                    RegistryError::InvalidParent
                );
                require_keys_neq!(
                    parent.key(),
                    ctx.accounts.record.key(),
                    RegistryError::InvalidParent
                );
            }
        }
        let clock = Clock::get()?;
        let record = &mut ctx.accounts.record;
        record.layout_version = RECORD_LAYOUT_VERSION;
        record.schema_version = args.schema_version;
        record.status = STATUS_ACTIVE;
        record.bump = ctx.bumps.record;
        record.publisher = ctx.accounts.publisher.key();
        record.manifest_hash = args.manifest_hash;
        record.content_digest = args.content_digest;
        record.relation = args.relation;
        record.parent_manifest_hash = args.parent_manifest_hash;
        record.cash_weight_bps = args.cash_weight_bps;
        record.legs = args.legs;
        record.registered_slot = clock.slot;
        record.registered_unix_time = clock.unix_timestamp;
        record.status_updated_slot = clock.slot;
        Ok(())
    }

    /// Mark a record deprecated (`STATUS_DEPRECATED`) or active again.
    ///
    /// Only the original publisher may sign. Nothing but `status` and
    /// `status_updated_slot` changes: the economic content of a record is
    /// immutable for the life of the chain.
    pub fn set_status(ctx: Context<SetStatus>, status: u8) -> Result<()> {
        require!(
            status == STATUS_ACTIVE || status == STATUS_DEPRECATED,
            RegistryError::UnknownStatus
        );
        let clock = Clock::get()?;
        let record = &mut ctx.accounts.record;
        record.status = status;
        record.status_updated_slot = clock.slot;
        Ok(())
    }
}

/// Every argument rule that does not need another account. Pure, so it can
/// be unit-tested without the runtime and mirrored byte for byte by the
/// TypeScript SDK (`@markov/registry`).
pub fn check_register_args(args: &RegisterVersionArgs) -> Result<()> {
    require!(
        args.schema_version == SCHEMA_VERSION,
        RegistryError::UnsupportedSchema
    );
    require!(args.manifest_hash != [0u8; 32], RegistryError::EmptyHash);
    require!(args.content_digest != [0u8; 32], RegistryError::EmptyHash);
    require!(!args.legs.is_empty(), RegistryError::NoLegs);
    require!(args.legs.len() <= MAX_LEGS, RegistryError::TooManyLegs);
    let mut total: u32 = 0;
    for leg in &args.legs {
        require!(leg.weight_bps >= 1, RegistryError::ZeroWeight);
        require!(leg.mint != Pubkey::default(), RegistryError::InvalidMint);
        require!(
            leg.token_program == SPL_TOKEN_PROGRAM_ID || leg.token_program == TOKEN_2022_PROGRAM_ID,
            RegistryError::UnsupportedTokenProgram
        );
        // At most 10 legs of at most 65,535 each: no u32 overflow is possible,
        // but stay explicit so a future cap change cannot introduce one.
        total = total
            .checked_add(u32::from(leg.weight_bps))
            .ok_or(error!(RegistryError::WeightTotal))?;
    }
    for pair in args.legs.windows(2) {
        require!(pair[0].mint < pair[1].mint, RegistryError::LegsNotSorted);
    }
    let total = total
        .checked_add(u32::from(args.cash_weight_bps))
        .ok_or(error!(RegistryError::WeightTotal))?;
    require!(total == TOTAL_BPS, RegistryError::WeightTotal);
    match args.relation {
        RELATION_NONE => {
            require!(
                args.parent_manifest_hash == [0u8; 32],
                RegistryError::InvalidParent
            );
        }
        RELATION_REVISION | RELATION_FORK => {
            require!(
                args.parent_manifest_hash != [0u8; 32],
                RegistryError::InvalidParent
            );
            require!(
                args.parent_manifest_hash != args.manifest_hash,
                RegistryError::InvalidParent
            );
        }
        _ => return err!(RegistryError::UnknownRelation),
    }
    Ok(())
}

/// One constituent: an admitted mint under its token program and its weight.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq, InitSpace)]
pub struct Leg {
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub weight_bps: u16,
}

/// Arguments of `register_version`, Borsh-encoded in this field order after
/// the 8-byte instruction discriminator.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct RegisterVersionArgs {
    pub schema_version: u16,
    pub manifest_hash: [u8; 32],
    pub content_digest: [u8; 32],
    pub relation: u8,
    pub parent_manifest_hash: [u8; 32],
    pub cash_weight_bps: u16,
    pub legs: Vec<Leg>,
}

/// The immutable record of one strategy version.
#[account]
#[derive(InitSpace, Debug, PartialEq, Eq)]
pub struct VersionRecord {
    pub layout_version: u8,
    pub schema_version: u16,
    pub status: u8,
    pub bump: u8,
    pub publisher: Pubkey,
    pub manifest_hash: [u8; 32],
    pub content_digest: [u8; 32],
    pub relation: u8,
    pub parent_manifest_hash: [u8; 32],
    pub cash_weight_bps: u16,
    #[max_len(10)]
    pub legs: Vec<Leg>,
    pub registered_slot: u64,
    pub registered_unix_time: i64,
    pub status_updated_slot: u64,
}

#[derive(Accounts)]
#[instruction(args: RegisterVersionArgs)]
pub struct RegisterVersion<'info> {
    /// The creator's wallet: signs, pays the rent and becomes the only status authority.
    #[account(mut)]
    pub publisher: Signer<'info>,
    #[account(
        init,
        payer = publisher,
        space = RECORD_SPACE,
        seeds = [RECORD_SEED, args.manifest_hash.as_ref()],
        bump
    )]
    pub record: Account<'info, VersionRecord>,
    /// The registered parent when `relation` is not `RELATION_NONE`; absent otherwise.
    pub parent_record: Option<Account<'info, VersionRecord>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetStatus<'info> {
    pub publisher: Signer<'info>,
    #[account(
        mut,
        has_one = publisher @ RegistryError::NotPublisher,
        seeds = [RECORD_SEED, record.manifest_hash.as_ref()],
        bump = record.bump
    )]
    pub record: Account<'info, VersionRecord>,
}

#[error_code]
pub enum RegistryError {
    #[msg("unsupported manifest schema version")]
    UnsupportedSchema,
    #[msg("a hash must not be all zeros")]
    EmptyHash,
    #[msg("a version needs at least one leg")]
    NoLegs,
    #[msg("more legs than the registry accepts")]
    TooManyLegs,
    #[msg("a leg weight must be at least 1 basis point")]
    ZeroWeight,
    #[msg("a leg mint must not be the default public key")]
    InvalidMint,
    #[msg("only SPL Token and Token-2022 mints are supported")]
    UnsupportedTokenProgram,
    #[msg("legs must be strictly ascending by mint")]
    LegsNotSorted,
    #[msg("leg weights plus cash must equal exactly 10,000 basis points")]
    WeightTotal,
    #[msg("unknown relation")]
    UnknownRelation,
    #[msg("parent reference does not match the relation")]
    InvalidParent,
    #[msg("unknown status")]
    UnknownStatus,
    #[msg("only the publisher may change the status")]
    NotPublisher,
}
