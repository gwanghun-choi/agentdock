-- 200k findings on the synthetic versions, for the rewrite's cost. Test database only.
insert into agentdock.capability_finding (package_version_id, detector_id, detector_version, category, signal, summary, source_path, commit_sha)
 select v.id, 'network', '1', 'network_request', 'url', 'references https://example.invalid/'||n, 'skills/s'||v.id||'/SKILL.md', v.commit_sha
 from agentdock.package_version v join agentdock.package p on p.id=v.package_id, generate_series(1,4) n
 where p.slug like 'syn%' limit 200000;
analyze agentdock.capability_finding;
