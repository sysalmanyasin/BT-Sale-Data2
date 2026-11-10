-- Final production limit for private Closing PDFs: 10 MiB.
update storage.buckets
set file_size_limit = 10485760
where id = 'closing-pdfs';
