//! Jobs feature: local file handling and the board scanner.

mod files;
mod scan;

pub use files::{pick_resume_file, save_job_file};
pub use scan::{cancel_job_scan, scan_job_providers, JobScanState};
