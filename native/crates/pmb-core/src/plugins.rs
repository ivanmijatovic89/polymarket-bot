//! Tick-scoped strategy plugins (computed once per tick, cached for the
//! cascading account callbacks of that tick).

use serde::{Deserialize, Serialize};

/// Which plugins a strategy wants, with their configuration.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct PluginRequest {}

/// Latest plugin outputs.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct PluginsSnapshot {}
