alter role service_role set statement_timeout = '150s';
notify pgrst, 'reload config';
