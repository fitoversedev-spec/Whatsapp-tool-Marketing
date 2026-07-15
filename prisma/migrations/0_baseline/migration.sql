-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "approval_status" TEXT NOT NULL DEFAULT 'pending',
    "rejection_reason" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "preferred_unit" TEXT NOT NULL DEFAULT 'ft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "header" TEXT,
    "body" TEXT NOT NULL,
    "footer" TEXT,
    "buttons" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "meta_template_id" TEXT,
    "rejection_reason" TEXT,
    "drafted_by_user_id" TEXT NOT NULL,
    "approved_by_user_id" TEXT,
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "contact_name" TEXT,
    "assigned_to_user_id" TEXT,
    "origin_broadcast_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "last_inbound_at" TIMESTAMP(3),
    "last_outbound_at" TIMESTAMP(3),
    "unread_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pipeline_stage" TEXT DEFAULT 'new',
    "stage_changed_at" TIMESTAMP(3),
    "deal_value" DECIMAL(12,2),
    "expected_close_at" TIMESTAMP(3),
    "lost_reason" TEXT,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "body" TEXT,
    "media_url" TEXT,
    "media_mime_type" TEXT,
    "media_file_name" TEXT,
    "media_size" INTEGER,
    "media_width" INTEGER,
    "media_height" INTEGER,
    "media_duration" INTEGER,
    "wa_message_id" TEXT,
    "template_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error_code" TEXT,
    "error_message" TEXT,
    "sent_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "name" TEXT,
    "allow_campaign" BOOLEAN NOT NULL DEFAULT true,
    "fields" TEXT NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcasts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source_type" TEXT NOT NULL DEFAULT 'file',
    "sheet_id" TEXT,
    "sheet_range" TEXT,
    "file_data" TEXT,
    "template_id" TEXT NOT NULL,
    "variable_mapping" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "total" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "delivered" INTEGER NOT NULL DEFAULT 0,
    "read" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduled_at" TIMESTAMP(3),
    "launched_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "pause_requested_at" TIMESTAMP(3),
    "paused_at" TIMESTAMP(3),

    CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcast_recipients" (
    "id" TEXT NOT NULL,
    "broadcast_id" TEXT NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "name" TEXT,
    "variables" TEXT NOT NULL,
    "wa_message_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error_code" TEXT,
    "error_message" TEXT,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),

    CONSTRAINT "broadcast_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opt_outs" (
    "phone_e164" TEXT NOT NULL,
    "opted_out_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,

    CONSTRAINT "opt_outs_pkey" PRIMARY KEY ("phone_e164")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "conversation_notes" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "author_user_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "edited_at" TIMESTAMP(3),

    CONSTRAINT "conversation_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "owner_user_id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "notified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_stage_history" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "from_stage" TEXT,
    "to_stage" TEXT NOT NULL,
    "changed_by_user_id" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'slate',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_tags" (
    "contact_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    "tagged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_tags_pkey" PRIMARY KEY ("contact_id","tag_id")
);

-- CreateTable
CREATE TABLE "conversation_labels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'slate',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_to_labels" (
    "conversation_id" TEXT NOT NULL,
    "label_id" TEXT NOT NULL,
    "labeled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_to_labels_pkey" PRIMARY KEY ("conversation_id","label_id")
);

-- CreateTable
CREATE TABLE "quotations" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "sport" TEXT NOT NULL DEFAULT 'football',
    "length_ft" INTEGER NOT NULL,
    "width_ft" INTEGER NOT NULL,
    "line_items" TEXT NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "gst_amount" DECIMAL(12,2) NOT NULL,
    "grand_total" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "caption" TEXT,
    "pdf_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "quote_date" TIMESTAMP(3) NOT NULL,
    "validity_days" INTEGER NOT NULL DEFAULT 30,
    "sent_at" TIMESTAMP(3),
    "conversation_id" TEXT,
    "contact_phone" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "duration" INTEGER,
    "category" TEXT NOT NULL DEFAULT 'other',
    "uploaded_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_reply_logs" (
    "id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "triggered_by" TEXT,
    "wa_message_id" TEXT,
    "fired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auto_reply_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_flows" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "path" TEXT,
    "current_step" TEXT NOT NULL,
    "collected_data" TEXT NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "end_reason" TEXT,

    CONSTRAINT "conversation_flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_leads" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "contact_name" TEXT,
    "path" TEXT NOT NULL,
    "location" TEXT,
    "size_ft" DECIMAL(10,2),
    "sport" TEXT,
    "maintenance_type" TEXT,
    "product_category" TEXT,
    "preferred_datetime" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'new',
    "assigned_to_user_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "court_images" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "layout" TEXT NOT NULL,
    "image_url" TEXT,
    "image_2d_url" TEXT,
    "image_3d_url" TEXT,
    "video_3d_url" TEXT,
    "caption" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "conversation_id" TEXT,
    "contact_phone" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "court_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_projects" (
    "id" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "location" TEXT,
    "sport" TEXT NOT NULL,
    "completion_date" TIMESTAMP(3),
    "plot_length_ft" INTEGER,
    "plot_width_ft" INTEGER,
    "surface_type" TEXT,
    "surface_grade" TEXT,
    "total_cost_inr" DECIMAL(12,2),
    "short_description" TEXT,
    "photos" TEXT NOT NULL DEFAULT '[]',
    "hero_photo_url" TEXT,
    "video_url" TEXT,
    "specs" TEXT NOT NULL DEFAULT '{}',
    "tags" TEXT NOT NULL DEFAULT '',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "sports" TEXT NOT NULL DEFAULT '[]',
    "category" TEXT,
    "hero_image_url" TEXT,
    "video_url" TEXT,
    "specs" TEXT NOT NULL DEFAULT '{}',
    "price_inr" DECIMAL(12,2),
    "unit" TEXT,
    "base_work" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_media" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'image',
    "caption" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tds_files" (
    "id" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "product_id" TEXT,
    "uploaded_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tds_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "templates_meta_template_id_key" ON "templates"("meta_template_id");

-- CreateIndex
CREATE INDEX "templates_status_idx" ON "templates"("status");

-- CreateIndex
CREATE INDEX "templates_deleted_at_idx" ON "templates"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_contact_phone_key" ON "conversations"("contact_phone");

-- CreateIndex
CREATE INDEX "conversations_assigned_to_user_id_idx" ON "conversations"("assigned_to_user_id");

-- CreateIndex
CREATE INDEX "conversations_status_idx" ON "conversations"("status");

-- CreateIndex
CREATE INDEX "conversations_pipeline_stage_idx" ON "conversations"("pipeline_stage");

-- CreateIndex
CREATE INDEX "conversations_assigned_to_user_id_last_inbound_at_idx" ON "conversations"("assigned_to_user_id", "last_inbound_at");

-- CreateIndex
CREATE INDEX "conversations_last_inbound_at_idx" ON "conversations"("last_inbound_at");

-- CreateIndex
CREATE UNIQUE INDEX "messages_wa_message_id_key" ON "messages"("wa_message_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_phone_e164_key" ON "contacts"("phone_e164");

-- CreateIndex
CREATE INDEX "broadcasts_created_by_user_id_idx" ON "broadcasts"("created_by_user_id");

-- CreateIndex
CREATE INDEX "broadcasts_status_idx" ON "broadcasts"("status");

-- CreateIndex
CREATE INDEX "broadcasts_scheduled_at_idx" ON "broadcasts"("scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "broadcast_recipients_wa_message_id_key" ON "broadcast_recipients"("wa_message_id");

-- CreateIndex
CREATE INDEX "broadcast_recipients_wa_message_id_idx" ON "broadcast_recipients"("wa_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "broadcast_recipients_broadcast_id_phone_e164_key" ON "broadcast_recipients"("broadcast_id", "phone_e164");

-- CreateIndex
CREATE INDEX "conversation_notes_conversation_id_created_at_idx" ON "conversation_notes"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "reminders_owner_user_id_due_at_idx" ON "reminders"("owner_user_id", "due_at");

-- CreateIndex
CREATE INDEX "reminders_due_at_completed_at_idx" ON "reminders"("due_at", "completed_at");

-- CreateIndex
CREATE INDEX "pipeline_stage_history_conversation_id_changed_at_idx" ON "pipeline_stage_history"("conversation_id", "changed_at");

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_key" ON "tags"("name");

-- CreateIndex
CREATE INDEX "contact_tags_tag_id_idx" ON "contact_tags"("tag_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_labels_name_key" ON "conversation_labels"("name");

-- CreateIndex
CREATE INDEX "conversation_to_labels_label_id_idx" ON "conversation_to_labels"("label_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_number_key" ON "quotations"("number");

-- CreateIndex
CREATE INDEX "quotations_status_idx" ON "quotations"("status");

-- CreateIndex
CREATE INDEX "quotations_conversation_id_idx" ON "quotations"("conversation_id");

-- CreateIndex
CREATE INDEX "quotations_contact_phone_idx" ON "quotations"("contact_phone");

-- CreateIndex
CREATE INDEX "quotations_created_at_idx" ON "quotations"("created_at");

-- CreateIndex
CREATE INDEX "media_category_idx" ON "media"("category");

-- CreateIndex
CREATE INDEX "media_uploaded_by_user_id_idx" ON "media"("uploaded_by_user_id");

-- CreateIndex
CREATE INDEX "auto_reply_logs_rule_id_contact_phone_fired_at_idx" ON "auto_reply_logs"("rule_id", "contact_phone", "fired_at");

-- CreateIndex
CREATE INDEX "auto_reply_logs_conversation_id_idx" ON "auto_reply_logs"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_flows_conversation_id_key" ON "conversation_flows"("conversation_id");

-- CreateIndex
CREATE INDEX "conversation_flows_current_step_idx" ON "conversation_flows"("current_step");

-- CreateIndex
CREATE INDEX "conversation_flows_updated_at_idx" ON "conversation_flows"("updated_at");

-- CreateIndex
CREATE INDEX "bot_leads_status_created_at_idx" ON "bot_leads"("status", "created_at");

-- CreateIndex
CREATE INDEX "bot_leads_path_idx" ON "bot_leads"("path");

-- CreateIndex
CREATE INDEX "bot_leads_assigned_to_user_id_idx" ON "bot_leads"("assigned_to_user_id");

-- CreateIndex
CREATE INDEX "bot_leads_conversation_id_idx" ON "bot_leads"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "court_images_number_key" ON "court_images"("number");

-- CreateIndex
CREATE INDEX "court_images_status_idx" ON "court_images"("status");

-- CreateIndex
CREATE INDEX "court_images_conversation_id_idx" ON "court_images"("conversation_id");

-- CreateIndex
CREATE INDEX "court_images_contact_phone_idx" ON "court_images"("contact_phone");

-- CreateIndex
CREATE INDEX "court_images_created_at_idx" ON "court_images"("created_at");

-- CreateIndex
CREATE INDEX "portfolio_projects_sport_idx" ON "portfolio_projects"("sport");

-- CreateIndex
CREATE INDEX "portfolio_projects_featured_idx" ON "portfolio_projects"("featured");

-- CreateIndex
CREATE INDEX "portfolio_projects_archived_idx" ON "portfolio_projects"("archived");

-- CreateIndex
CREATE INDEX "products_type_idx" ON "products"("type");

-- CreateIndex
CREATE INDEX "products_featured_idx" ON "products"("featured");

-- CreateIndex
CREATE INDEX "products_archived_idx" ON "products"("archived");

-- CreateIndex
CREATE INDEX "product_media_product_id_idx" ON "product_media"("product_id");

-- CreateIndex
CREATE INDEX "tds_files_sport_idx" ON "tds_files"("sport");

-- CreateIndex
CREATE INDEX "tds_files_product_id_idx" ON "tds_files"("product_id");

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_drafted_by_user_id_fkey" FOREIGN KEY ("drafted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_origin_broadcast_id_fkey" FOREIGN KEY ("origin_broadcast_id") REFERENCES "broadcasts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sent_by_user_id_fkey" FOREIGN KEY ("sent_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "broadcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_notes" ADD CONSTRAINT "conversation_notes_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_notes" ADD CONSTRAINT "conversation_notes_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_stage_history" ADD CONSTRAINT "pipeline_stage_history_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_stage_history" ADD CONSTRAINT "pipeline_stage_history_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_to_labels" ADD CONSTRAINT "conversation_to_labels_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_to_labels" ADD CONSTRAINT "conversation_to_labels_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "conversation_labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_reply_logs" ADD CONSTRAINT "auto_reply_logs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_flows" ADD CONSTRAINT "conversation_flows_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_leads" ADD CONSTRAINT "bot_leads_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "court_images" ADD CONSTRAINT "court_images_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "court_images" ADD CONSTRAINT "court_images_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_projects" ADD CONSTRAINT "portfolio_projects_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tds_files" ADD CONSTRAINT "tds_files_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

