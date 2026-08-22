import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const prospectStatusEnum = pgEnum("prospect_status", [
  "NOUVEAU",
  "EN_ATTENTE",
  "INTERESSE",
  "DEMANDE_DE_PRIX",
  "PAS_INTERESSE",
  "A_RELANCER",
  "QUESTION",
  "A_VERIFIER",
  "EMAIL_INVALIDE",
  "EXCLU",
]);

export const platformEnum = pgEnum("platform", [
  "instagram",
  "tiktok",
  "facebook",
  "youtube",
]);

export const socialSourceEnum = pgEnum("social_source", [
  "site_web",
  "cse",
  "youtube_api",
]);

export const contactTypeEnum = pgEnum("contact_type", [
  "email_generique",
  "email_service",
  "email_nominatif",
]);

export const directionEnum = pgEnum("direction", ["sortant", "entrant"]);

export const messageChannelEnum = pgEnum("message_channel", [
  "email",
  "instagram",
  "tiktok",
  "facebook",
  "youtube",
]);

export const messageStatusEnum = pgEnum("message_status", [
  "brouillon",
  "en_attente_revue",
  "planifie",
  "envoi_en_cours",
  "envoye",
  "echec",
  "recu",
]);

export const dmQueueStatusEnum = pgEnum("dm_queue_status", [
  "a_envoyer",
  "envoye",
  "ignore",
]);

export const exclusionScopeEnum = pgEnum("exclusion_scope", ["email", "domaine"]);

export const exclusionReasonEnum = pgEnum("exclusion_reason", [
  "desinscription",
  "refus_reponse",
  "bounce_hard",
  "manuel",
]);

export const changedByEnum = pgEnum("changed_by", ["systeme", "ia", "humain"]);

export const discoverySourceEnum = pgEnum("discovery_source", [
  "places",
  "youtube",
  "cse_instagram",
  "cse_tiktok",
  "cse_facebook",
  "osm",
  "manuel",
]);

// ---------------------------------------------------------------------------
// Tables métier
// ---------------------------------------------------------------------------

export const prospects = pgTable(
  "prospects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyName: text("company_name").notNull(),
    niche: text("niche"),
    locationCity: text("location_city"),
    locationCountry: text("location_country"),
    websiteUrl: text("website_url"),
    // Domaine normalisé (sans www, minuscules) — clé de déduplication n°1
    websiteDomain: text("website_domain"),
    // Téléphone normalisé E.164 — clé de déduplication n°2
    phone: text("phone"),
    siret: text("siret"),
    description: text("description"),
    discoverySource: discoverySourceEnum("discovery_source").notNull().default("manuel"),
    discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
    enrichedAt: timestamp("enriched_at", { withTimezone: true }),
    firstContactedAt: timestamp("first_contacted_at", { withTimezone: true }),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    status: prospectStatusEnum("status").notNull().default("NOUVEAU"),
    aiConfidence: real("ai_confidence"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("prospects_website_domain_uq")
      .on(t.websiteDomain)
      .where(sql`${t.websiteDomain} IS NOT NULL`),
    index("prospects_phone_idx").on(t.phone),
    index("prospects_status_idx").on(t.status),
    index("prospects_company_city_idx").on(t.companyName, t.locationCity),
  ],
);

export const socialProfiles = pgTable(
  "social_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    prospectId: uuid("prospect_id")
      .notNull()
      .references(() => prospects.id, { onDelete: "cascade" }),
    platform: platformEnum("platform").notNull(),
    username: text("username"),
    profileUrl: text("profile_url").notNull(),
    // Fiable uniquement via l'API YouTube ; null ailleurs
    followersCount: integer("followers_count"),
    bioSnippet: text("bio_snippet"),
    source: socialSourceEnum("source").notNull(),
    discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("social_profiles_platform_url_uq").on(t.platform, t.profileUrl)],
);

export const contactChannels = pgTable(
  "contact_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    prospectId: uuid("prospect_id")
      .notNull()
      .references(() => prospects.id, { onDelete: "cascade" }),
    type: contactTypeEnum("type").notNull(),
    value: text("value").notNull(),
    priority: integer("priority").notNull().default(0),
    mxValid: boolean("mx_valid"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    isPrimary: boolean("is_primary").notNull().default(false),
    sourceUrl: text("source_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contact_channels_prospect_value_uq").on(t.prospectId, t.value),
    index("contact_channels_value_idx").on(t.value),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    prospectId: uuid("prospect_id")
      .notNull()
      .references(() => prospects.id, { onDelete: "cascade" }),
    direction: directionEnum("direction").notNull(),
    channel: messageChannelEnum("channel").notNull(),
    subject: text("subject"),
    bodyText: text("body_text").notNull().default(""),
    bodyHtml: text("body_html"),
    smtpMessageId: text("smtp_message_id"),
    inReplyTo: text("in_reply_to"),
    // 0 = email initial, 1 = relance
    sequenceStep: integer("sequence_step").notNull().default(0),
    aiGenerated: boolean("ai_generated").notNull().default(false),
    aiModel: text("ai_model"),
    status: messageStatusEnum("status").notNull().default("brouillon"),
    isAutoReply: boolean("is_auto_reply").notNull().default(false),
    isBounce: boolean("is_bounce").notNull().default(false),
    fromAddress: text("from_address"),
    toAddress: text("to_address"),
    errorMessage: text("error_message"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("messages_prospect_idx").on(t.prospectId),
    index("messages_status_idx").on(t.status),
    index("messages_smtp_id_idx").on(t.smtpMessageId),
    // Un seul message sortant « actif » (en revue / planifié / en cours) par prospect
    uniqueIndex("messages_one_active_outbound_uq")
      .on(t.prospectId)
      .where(
        sql`${t.direction} = 'sortant' AND ${t.status} IN ('en_attente_revue', 'planifie', 'envoi_en_cours')`,
      ),
  ],
);

export const classifications = pgTable(
  "classifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    confidence: real("confidence").notNull(),
    model: text("model").notNull(),
    rawJson: jsonb("raw_json"),
    humanValidated: boolean("human_validated").notNull().default(false),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("classifications_message_idx").on(t.messageId)],
);

export const dailyQuotas = pgTable(
  "daily_quotas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Date locale (Europe/Paris par défaut) au format YYYY-MM-DD :
    // la remise à zéro de minuit est implicite (nouvelle ligne chaque jour).
    dateLocale: text("date_locale").notNull(),
    key: text("key").notNull(),
    used: integer("used").notNull().default(0),
    max: integer("max").notNull(),
  },
  (t) => [uniqueIndex("daily_quotas_date_key_uq").on(t.dateLocale, t.key)],
);

export const manualDmQueue = pgTable(
  "manual_dm_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    prospectId: uuid("prospect_id")
      .notNull()
      .references(() => prospects.id, { onDelete: "cascade" }),
    platform: platformEnum("platform").notNull(),
    messageText: text("message_text").notNull(),
    status: dmQueueStatusEnum("status").notNull().default("a_envoyer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    handledAt: timestamp("handled_at", { withTimezone: true }),
  },
  (t) => [index("manual_dm_queue_status_idx").on(t.status)],
);

export const exclusionList = pgTable(
  "exclusion_list",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Email normalisé (minuscules) ou domaine
    value: text("value").notNull(),
    scope: exclusionScopeEnum("scope").notNull(),
    reason: exclusionReasonEnum("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("exclusion_value_scope_uq").on(t.value, t.scope)],
);

export const statusHistory = pgTable(
  "status_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    prospectId: uuid("prospect_id")
      .notNull()
      .references(() => prospects.id, { onDelete: "cascade" }),
    oldStatus: prospectStatusEnum("old_status"),
    newStatus: prospectStatusEnum("new_status").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
    changedBy: changedByEnum("changed_by").notNull(),
  },
  (t) => [index("status_history_prospect_idx").on(t.prospectId)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Pattern outbox : alimentée en V1, consommée par les modules V2
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [index("events_type_idx").on(t.type)],
);

export const appLogs = pgTable(
  "app_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    level: text("level").notNull().default("info"),
    scope: text("scope").notNull(),
    message: text("message").notNull(),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("app_logs_scope_idx").on(t.scope), index("app_logs_created_idx").on(t.createdAt)],
);

// Compteurs d'usage API (paliers gratuits) — clé ex. "places:details", "youtube:units"
export const apiUsage = pgTable(
  "api_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    monthLocale: text("month_locale").notNull(), // YYYY-MM (fuseau configuré)
    key: text("key").notNull(),
    used: integer("used").notNull().default(0),
  },
  (t) => [uniqueIndex("api_usage_month_key_uq").on(t.monthLocale, t.key)],
);

// ---------------------------------------------------------------------------
// Tables Better Auth (mono-utilisateur)
// ---------------------------------------------------------------------------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Types dérivés
// ---------------------------------------------------------------------------

export type Prospect = typeof prospects.$inferSelect;
export type NewProspect = typeof prospects.$inferInsert;
export type SocialProfile = typeof socialProfiles.$inferSelect;
export type NewSocialProfile = typeof socialProfiles.$inferInsert;
export type ContactChannel = typeof contactChannels.$inferSelect;
export type NewContactChannel = typeof contactChannels.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Classification = typeof classifications.$inferSelect;
export type ManualDm = typeof manualDmQueue.$inferSelect;
export type ExclusionEntry = typeof exclusionList.$inferSelect;
export type AppEvent = typeof events.$inferSelect;
export type ProspectStatus = (typeof prospectStatusEnum.enumValues)[number];
export type Platform = (typeof platformEnum.enumValues)[number];
export type DiscoverySourceId = (typeof discoverySourceEnum.enumValues)[number];
export type MessageChannel = (typeof messageChannelEnum.enumValues)[number];
