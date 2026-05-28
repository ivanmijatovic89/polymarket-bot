-- Widen `backtests.cmd` from TEXT (~64KB) to LONGTEXT (~4GB) so we can
-- store the full CLI invocation when it includes very long --slug lists
-- (e.g. 3000 slugs via shell expansion).
ALTER TABLE `backtests` MODIFY `cmd` longtext;
