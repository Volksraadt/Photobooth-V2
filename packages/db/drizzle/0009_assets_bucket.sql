-- Supabase Storage bucket for Studio uploads (booth assets, frame library), open-questions #18.
-- Public read (configs reference public URLs); members write only under their own org folder
-- (`<org_id>/...`). Skipped on databases without Supabase Storage (tests, plain Postgres).
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO storage.buckets (id, name, public, file_size_limit)
  VALUES ('assets', 'assets', true, 83886080)
  ON CONFLICT (id) DO UPDATE SET public = true;

  DROP POLICY IF EXISTS "assets_member_read" ON storage.objects;
  DROP POLICY IF EXISTS "assets_member_insert" ON storage.objects;
  DROP POLICY IF EXISTS "assets_member_update" ON storage.objects;
  CREATE POLICY "assets_member_read" ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'assets' AND app.is_org_member((storage.foldername(name))[1]));
  CREATE POLICY "assets_member_insert" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'assets' AND app.is_org_member((storage.foldername(name))[1]));
  CREATE POLICY "assets_member_update" ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'assets' AND app.is_org_member((storage.foldername(name))[1]))
    WITH CHECK (bucket_id = 'assets' AND app.is_org_member((storage.foldername(name))[1]));
END $$;
