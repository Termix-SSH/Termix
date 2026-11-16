//! The fence for one plugin process, as Electron main sends it.

use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Policy {
    /// Plugin id, used to name the Windows AppContainer.
    pub name: String,
    /// Folders and files the process may read (and run, for the runtime).
    pub read: Vec<PathBuf>,
    /// Folders the process may read and write. Only its own data folder.
    pub write: Vec<PathBuf>,
    /// The process may open sockets.
    pub net: bool,
    /// The process may start other processes.
    pub child_process: bool,
    /// The process may load native addons and open serial devices.
    pub addons: bool,
    /// Hard memory cap in MB, killed above it.
    pub memory_mb: u64,
}

pub const MIN_MEMORY_MB: u64 = 128;
pub const MAX_MEMORY_MB: u64 = 8192;

fn is_plugin_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 64
        && (bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit())
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
}

impl Policy {
    pub fn parse(text: &str) -> Result<Policy, String> {
        let policy: Policy = serde_json::from_str(text).map_err(|e| format!("bad policy: {e}"))?;
        policy.check()?;
        Ok(policy)
    }

    fn check(&self) -> Result<(), String> {
        if !is_plugin_id(&self.name) {
            return Err("bad plugin id".into());
        }
        if self.memory_mb < MIN_MEMORY_MB || self.memory_mb > MAX_MEMORY_MB {
            return Err("memory cap out of range".into());
        }
        if self.write.len() > 1 {
            return Err("a plugin writes only its own folder".into());
        }
        for path in self.read.iter().chain(self.write.iter()) {
            if !path.is_absolute() {
                return Err("paths must be absolute".into());
            }
            let text = path.to_string_lossy();
            if text.contains('*') || text.contains('\0') || text.contains('"') {
                return Err("bad path".into());
            }
        }
        Ok(())
    }

    pub fn memory_bytes(&self) -> u64 {
        self.memory_mb * 1024 * 1024
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(extra: &str) -> String {
        let root = if cfg!(windows) { "C:\\\\x" } else { "/x" };
        format!(
            r#"{{"name":"fence-probe","read":["{root}"],"write":["{root}"],"net":false,"childProcess":false,"addons":false,"memoryMb":512{extra}}}"#
        )
    }

    #[test]
    fn parses_a_good_policy() {
        let p = Policy::parse(&sample("")).unwrap();
        assert_eq!(p.name, "fence-probe");
        assert_eq!(p.memory_bytes(), 512 * 1024 * 1024);
    }

    #[test]
    fn refuses_unknown_fields() {
        assert!(Policy::parse(&sample(r#","extra":true"#)).is_err());
    }

    #[test]
    fn refuses_relative_paths() {
        let text = r#"{"name":"a","read":["rel"],"write":[],"net":false,"childProcess":false,"addons":false,"memoryMb":512}"#;
        assert!(Policy::parse(text).is_err());
    }

    #[test]
    fn refuses_bad_ids_and_caps() {
        let text = sample("").replace("fence-probe", "../x");
        assert!(Policy::parse(&text).is_err());
        let text = sample("").replace("512", "1");
        assert!(Policy::parse(&text).is_err());
    }

    #[test]
    fn refuses_two_write_folders() {
        let root = if cfg!(windows) { "C:\\\\x" } else { "/x" };
        let text = format!(
            r#"{{"name":"a","read":[],"write":["{root}","{root}"],"net":false,"childProcess":false,"addons":false,"memoryMb":512}}"#
        );
        assert!(Policy::parse(&text).is_err());
    }
}
