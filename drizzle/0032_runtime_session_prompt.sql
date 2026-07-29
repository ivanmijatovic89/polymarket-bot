ALTER TABLE `runtime_sessions`
  ADD COLUMN `prompt` text,
  ADD COLUMN `contract_version` int,
  ADD COLUMN `mission_hash` varchar(64);
