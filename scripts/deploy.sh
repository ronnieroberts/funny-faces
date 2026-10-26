#!/bin/bash
# Publishes dist/ to an S3 bucket behind CloudFront with aggressive caching.
#   BUCKET=<bucket> DISTRIBUTION=<cloudfront id> bash scripts/deploy.sh
# Scripts are content-hashed, so they are cached for a year. index.html is cached for a minute.
set -euo pipefail
: "${BUCKET:?set BUCKET}" "${DISTRIBUTION:?set DISTRIBUTION}"
node scripts/build.mjs >/dev/null
aws s3 sync dist/assets "s3://$BUCKET/assets" --cache-control "public,max-age=31536000,immutable" --content-type "text/javascript"
[ -d media ] && aws s3 sync media "s3://$BUCKET/media" --cache-control "public,max-age=31536000,immutable"
aws s3 cp dist/index.html "s3://$BUCKET/index.html" --cache-control "public,max-age=60,stale-while-revalidate=86400" --content-type "text/html"
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION" --paths "/index.html" "/" >/dev/null
echo "Deployed."
