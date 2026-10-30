#!/bin/sh
# Cria os papéis e bancos de desenvolvimento/teste.
# reparo_migrator é dono do schema; reparo_app é o papel da API e não contorna RLS.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE reparo_migrator LOGIN PASSWORD '${MIGRATOR_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE reparo_app LOGIN PASSWORD '${APP_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE DATABASE reparo360_dev OWNER reparo_migrator;
CREATE DATABASE reparo360_test OWNER reparo_migrator;
SQL

for db in reparo360_dev reparo360_test; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" <<SQL
REVOKE ALL ON DATABASE $db FROM PUBLIC;
GRANT CONNECT ON DATABASE $db TO reparo_app;
GRANT CREATE, CONNECT ON DATABASE $db TO reparo_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO reparo_app;
GRANT ALL ON SCHEMA public TO reparo_migrator;
SQL
done
