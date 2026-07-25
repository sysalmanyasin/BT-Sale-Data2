# Setting up the PDF Library backend

I can't run this from here — this sandbox has no network access to
supabase.com. Steps to set it up yourself, once, against the same
Supabase project this app already syncs to (URL/key in `js/supabase.js`):

## 1. Create the table + policies
Supabase Dashboard → SQL Editor → paste in `schema.sql` from this folder
→ Run. This also tries to create the storage bucket via SQL, but step 2
is more reliable for that part.

## 2. Create the storage bucket (if the SQL insert didn't take)
Dashboard → Storage → New bucket:
- Name: `pdf-library`
- Public bucket: **on** (the library UI links straight to the public
  URL for viewing/downloading — no signed-URL step needed)

If you'd rather keep it private, flip `public` to `false` on the bucket
and in `schema.sql`, and change `js/pdf-library.js`'s `_publicUrl()` to
call `createSignedUrl()` instead — it's the one place that assumes a
public bucket.

## 3. Confirm
Print any report in the app → the category/expiry prompt should appear
→ pick a category and hit Save → open the PDF Library page (nav →
📚 PDF Library) → the report should show up within a few seconds.
