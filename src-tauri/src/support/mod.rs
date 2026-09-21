//! Cross-cutting primitives.
//!
//! Process plumbing, and finding the external tools Pulse shells out to. These
//! know nothing about sources, jobs or models, which is what keeps every other
//! module free to depend on them without a cycle.

pub mod node;
pub mod proc;
pub mod python;
