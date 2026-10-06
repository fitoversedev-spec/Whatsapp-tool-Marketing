-- Re-runs the "attach documents to the customer" backfill from
-- 20261005180000 for anything the previous code wrote while this release was
-- on hold, and also links old deals' reminders and activities to the deal's
-- customer. Every statement only fills blanks, so running it again is safe.

UPDATE "quotations" q SET "account_contact_id" = d."primary_contact_id"
FROM "deals" d
WHERE q."deal_id" = d."id" AND d."primary_contact_id" IS NOT NULL AND q."account_contact_id" IS NULL;

UPDATE "quotations" q SET "account_contact_id" = c."id"
FROM "account_contacts" c
WHERE q."account_contact_id" IS NULL AND q."contact_phone" IS NOT NULL
  AND c."phone" = q."contact_phone" AND c."deleted_at" IS NULL
  AND (SELECT count(*) FROM "account_contacts" c2 WHERE c2."phone" = q."contact_phone" AND c2."deleted_at" IS NULL) = 1;

UPDATE "court_images" ci SET "account_contact_id" = d."primary_contact_id"
FROM "deals" d
WHERE ci."deal_id" = d."id" AND d."primary_contact_id" IS NOT NULL AND ci."account_contact_id" IS NULL;

UPDATE "reminders" r SET "account_contact_id" = d."primary_contact_id"
FROM "deals" d
WHERE r."deal_id" = d."id" AND d."primary_contact_id" IS NOT NULL AND r."account_contact_id" IS NULL;

UPDATE "activities" a SET "account_contact_id" = d."primary_contact_id"
FROM "deals" d
WHERE a."deal_id" = d."id" AND d."primary_contact_id" IS NOT NULL AND a."account_contact_id" IS NULL;

-- Product interest noted on a deal moves onto the customer (skipping any the
-- customer already has).
INSERT INTO "contact_product_interests" ("id", "account_contact_id", "product_id", "sport_id", "label", "created_at")
SELECT gen_random_uuid(), d."primary_contact_id", li."product_id", li."sport_id", li."label", li."created_at"
FROM "deal_line_items" li
JOIN "deals" d ON d."id" = li."deal_id"
WHERE li."is_enquiry_only" = true AND d."primary_contact_id" IS NOT NULL AND d."deleted_at" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "contact_product_interests" p
    WHERE p."account_contact_id" = d."primary_contact_id"
      AND (
        (li."product_id" IS NOT NULL AND p."product_id" = li."product_id")
        OR (li."product_id" IS NULL AND p."product_id" IS NULL AND lower(coalesce(p."label", '')) = lower(coalesce(li."label", '')))
      )
  );
