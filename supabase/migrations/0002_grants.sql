-- Let signed-in people reach the tables through the API.
-- Row level security (in 0001) still decides which rows each person sees.
-- Logged-out visitors get nothing.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
