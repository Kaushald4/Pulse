//! First-run setup.
//!
//! Everything Pulse cannot bundle but does depend on. Run once, reporting each
//! component as it lands, so a slow install reads as progress rather than a hang.

pub mod components;
pub mod flow;
pub mod toolchains;
pub mod venv;

pub use flow::{dismiss_setup, run_setup, setup_status};
