//! The extraction engine Pulse drives for everything it cannot fetch itself.
//!
//! helmsman is a Node CLI, so this is a bridge: where the binary is, how to run
//! it, how to install it, and the browser profiles it reads through. Every
//! capability is re-exported here, so callers keep using `crate::helmsman::X`
//! regardless of which file inside owns it.

pub mod archive;
pub mod chrome;
pub mod install;
pub mod resolve;
pub mod run;

pub use chrome::{check_profile_status, disconnect_profile, launch_auth_login};
pub use install::{install_helmsman, install_with_progress};
pub use resolve::{resolve, version_for};
pub use run::{helmsman_status, run_helmsman_extract};
