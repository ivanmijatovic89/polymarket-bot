ALTER TABLE `runtime_sessions`
  ADD COLUMN `cache_read_input_tokens` bigint,
  ADD COLUMN `cache_creation_input_tokens` bigint,
  ADD COLUMN `estimated_api_cost_usd` decimal(18,8),
  ADD COLUMN `resolved_model` varchar(255);
