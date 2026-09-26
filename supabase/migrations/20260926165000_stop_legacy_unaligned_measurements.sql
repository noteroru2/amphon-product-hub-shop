-- Stop legacy pre-executor measurements that cannot satisfy the aligned immutable baseline contract.
-- They remain visible as historical executions but no longer hold a Page Experiment Lock forever.

update public.commerce_gsc_action_executions
set
  monitor_status='STOPPED',
  rollback_review_reason='Measurement Integrity Guard stopped this legacy execution because it has no aligned immutable primary-query baseline.',
  notes=concat_ws(E'\n',notes,'Legacy measurement stopped by Measurement Integrity Guard; no automatic verdict or rollback is permitted without an aligned baseline.')
where monitor_status in ('MONITORING','ROLLBACK_REVIEW')
  and executor_job_id is null
  and baseline_query_fetched_at is null;

select private.refresh_gsc_executor_guards();
