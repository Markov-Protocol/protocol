//! `cargo run --manifest-path programs/idl-build/Cargo.toml` writes
//! `programs/strategy-registry/idl/markov_strategy_registry.json` using the
//! same builder the Anchor CLI uses (`anchor idl build`), so the committed
//! IDL is reproducible from the program source without the CLI.
use anchor_lang_idl::build::IdlBuilder;
use std::{env, fs, path::PathBuf};

fn main() -> anyhow::Result<()> {
    let here = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let program = here.join("../strategy-registry").canonicalize()?;
    let out = env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| program.join("idl/markov_strategy_registry.json"));
    let idl = IdlBuilder::new()
        .program_path(program)
        .resolution(true)
        .skip_lint(false)
        .no_docs(false)
        .build()?;
    let rendered = format!("{}\n", serde_json::to_string_pretty(&idl)?);
    fs::write(&out, rendered)?;
    println!("wrote {}", out.display());
    Ok(())
}
