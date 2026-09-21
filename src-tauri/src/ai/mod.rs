//! Model calls.
//!
//! Two engines, chosen by the user: Jev when it is configured, and any
//! OpenAI-compatible provider otherwise. The classifier and the generator are the
//! same call with different task config, which is why they share a transport.
//!
//! Neither engine is required. Anything that wants a judgement takes one as an
//! argument rather than reaching for a specific provider.

pub mod chat;
pub mod client;
pub mod jev;
pub mod probe;

pub use chat::ai_chat;
pub use jev::ai_jev;
pub use probe::test_connection;
