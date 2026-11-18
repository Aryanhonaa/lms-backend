-- Already added by 20261009090000_call_recordings; keep idempotent for environments that still run this file.
ALTER TYPE "ResourceKind" ADD VALUE IF NOT EXISTS 'CALL_RECORDING';
