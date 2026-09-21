//! Getting text out of the world.
//!
//! Four ways in: a page handed to the extraction engines, a feed, GitHub
//! trending, and a link's preview metadata. Each returns the same shape of
//! content, so nothing downstream cares which one produced it.

pub mod extract;
pub mod feed;
pub mod github;
pub mod metadata;

pub use extract::extract_content;
pub use feed::fetch_feed;
pub use github::github_trending;
pub use metadata::fetch_link_metadata;
