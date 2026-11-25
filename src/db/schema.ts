import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const agencyRoles = pgTable('agency_roles', {
  id: serial('id').primaryKey(),
  role: text('role').notNull().unique(), // 'manager' | 'employee'
  passwordHash: text('password_hash').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  role: text('role').notNull().default('employee'), // 'manager' | 'employee'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const vehicles = pgTable(
  'vehicles',
  {
    id: serial('id').primaryKey(),
    brand: text('brand').notNull(),
    model: text('model').notNull(),
    year: integer('year').notNull(),
    color: text('color').notNull(),
    registrationNumber: text('registration_number').notNull().unique(),
    dailyPriceDzd: integer('daily_price_dzd').notNull(),
    currentMileage: integer('current_mileage').notNull().default(0),
    photoPath: text('photo_path').notNull(),
    fuelType: text('fuel_type').notNull().default('Essence'),
    transmission: text('transmission').notNull().default('Manuelle'),
    seats: integer('seats').notNull().default(5),
    chassisNumber: text('chassis_number').default(''),
    engineSeries: text('engine_series').default(''),
    manualStatus: text('manual_status').notNull().default('available'), // 'available' | 'maintenance'
    version: integer('version').notNull().default(1),
    idempotencyKey: text('idempotency_key'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedByRole: text('archived_by_role'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('vehicles_registration_idx').on(table.registrationNumber)],
);

export const customers = pgTable(
  'customers',
  {
    id: serial('id').primaryKey(),
    fullName: text('full_name').notNull(),
    dateOfBirth: text('date_of_birth').default(''),
    birthPlace: text('birth_place').default(''),
    phone: text('phone').notNull(),
    address: text('address').default(''),
    email: text('email').default(''),
    idType: text('id_type').default('CNI'),
    idNumber: text('id_number').default(''),
    idIssuedBy: text('id_issued_by').default(''),
    country: text('country').default('Algérie'),
    licenceNumber: text('licence_number').default(''),
    licenceFrontPath: text('licence_front_path').default(''),
    licenceBackPath: text('licence_back_path').default(''),
    version: integer('version').notNull().default(1),
    idempotencyKey: text('idempotency_key'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedByRole: text('archived_by_role'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('customers_phone_idx').on(table.phone)],
);

export interface RentalConditionArticle {
  number: string;
  titleAr: string;
  bodyAr: string;
  titleFr: string;
  bodyFr: string;
  titleEn: string;
  bodyEn: string;
}

export const rentalConditionsVersions = pgTable('rental_conditions_versions', {
  id: serial('id').primaryKey(),
  versionNumber: text('version_number').notNull().unique(),
  isPublished: boolean('is_published').notNull().default(false),
  articlesJson: jsonb('articles_json').$type<RentalConditionArticle[]>().notNull(),
  createdByRole: text('created_by_role').notNull().default('manager'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const reservations = pgTable(
  'reservations',
  {
    id: serial('id').primaryKey(),
    reservationCode: text('reservation_code').notNull().unique(),
    vehicleId: integer('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'restrict' }),
    customerId: integer('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    startDate: timestamp('start_date', { withTimezone: true }).notNull(),
    endDate: timestamp('end_date', { withTimezone: true }).notNull(),
    dailyPriceDzd: integer('daily_price_dzd').notNull(),
    totalAmountDzd: integer('total_amount_dzd').notNull(),
    status: text('status').notNull().default('confirmed'), // 'pending' | 'confirmed' | 'converted' | 'cancelled'
    source: text('source').notNull().default('admin'), // 'admin' | 'website'
    conditionsVersionId: integer('conditions_version_id').references(
      () => rentalConditionsVersions.id,
      { onDelete: 'set null' },
    ),
    conditionsAcceptedAt: timestamp('conditions_accepted_at', { withTimezone: true }),
    notes: text('notes').default(''),
    version: integer('version').notNull().default(1),
    idempotencyKey: text('idempotency_key'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedByRole: text('archived_by_role'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('reservations_vehicle_dates_idx').on(table.vehicleId, table.startDate, table.endDate),
  ],
);

export const rentalContracts = pgTable(
  'rental_contracts',
  {
    id: serial('id').primaryKey(),
    contractNumber: text('contract_number').notNull().unique(),
    reservationId: integer('reservation_id').references(() => reservations.id, {
      onDelete: 'set null',
    }),
    vehicleId: integer('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'restrict' }),
    customerId: integer('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    driverCustomerId: integer('driver_customer_id').references(() => customers.id, {
      onDelete: 'set null',
    }),
    driverName: text('driver_name').default(''),
    driverDob: text('driver_dob').default(''),
    driverIdNumber: text('driver_id_number').default(''),
    driverLicenceNumber: text('driver_licence_number').default(''),
    driverCountry: text('driver_country').default(''),
    driverAddress: text('driver_address').default(''),
    driverPhone: text('driver_phone').default(''),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    durationDays: integer('duration_days').notNull(),
    dailyPriceDzd: integer('daily_price_dzd').notNull(),
    totalAmountDzd: integer('total_amount_dzd').notNull(),
    depositDzd: integer('deposit_dzd').notNull().default(0),
    amountPaidDzd: integer('amount_paid_dzd').notNull().default(0),
    departureMileage: integer('departure_mileage').notNull(),
    departureFuelLevel: text('departure_fuel_level').notNull().default('4/4'),
    departureNotes: text('departure_notes').default(''),
    departureDamageJson: jsonb('departure_damage_json').$type<string[]>().default([]),
    conditionsVersionId: integer('conditions_version_id').references(
      () => rentalConditionsVersions.id,
      { onDelete: 'set null' },
    ),
    conditionsSnapshotJson: jsonb('conditions_snapshot_json').$type<RentalConditionArticle[]>(),
    status: text('status').notNull().default('pending'), // 'pending' | 'confirmed' | 'completed' | 'upcoming' | 'active' | 'cancelled'
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    pickupLocation: text('pickup_location').default('Blida'),
    returnLocation: text('return_location').default('Blida'),
    extensionNumber: text('extension_number').default(''),
    extensionStartAt: timestamp('extension_start_at', { withTimezone: true }),
    extensionEndAt: timestamp('extension_end_at', { withTimezone: true }),
    extensionDays: integer('extension_days').default(0),
    extensionFromDate: text('extension_from_date').default(''),
    extensionUntilDate: text('extension_until_date').default(''),
    extensionExitTime: text('extension_exit_time').default(''),
    extensionEntryTime: text('extension_entry_time').default(''),
    earlyReturnDate: text('early_return_date').default(''),
    earlyReturnTime: text('early_return_time').default(''),
    earlyReturnLocation: text('early_return_location').default(''),
    maxMileageLimit: integer('max_mileage_limit'),
    version: integer('version').notNull().default(1),
    idempotencyKey: text('idempotency_key'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedByRole: text('archived_by_role'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('contracts_vehicle_dates_idx').on(table.vehicleId, table.startAt, table.endAt),
  ],
);

export const vehicleReturns = pgTable('vehicle_returns', {
  id: serial('id').primaryKey(),
  contractId: integer('contract_id')
    .notNull()
    .unique()
    .references(() => rentalContracts.id, { onDelete: 'cascade' }),
  vehicleId: integer('vehicle_id')
    .notNull()
    .references(() => vehicles.id, { onDelete: 'restrict' }),
  returnedAt: timestamp('returned_at', { withTimezone: true }).notNull(),
  returnMileage: integer('return_mileage').notNull(),
  fuelLevel: text('fuel_level').notNull().default('4/4'),
  conditionNotes: text('condition_notes').default(''),
  damageMarkersJson: jsonb('damage_markers_json').$type<string[]>().default([]),
  lateHours: integer('late_hours').notNull().default(0),
  lateFeeDzd: integer('late_fee_dzd').notNull().default(0),
  allowedKm: integer('allowed_km').notNull().default(0),
  drivenKm: integer('driven_km').notNull().default(0),
  extraKm: integer('extra_km').notNull().default(0),
  extraKmFeeDzd: integer('extra_km_fee_dzd').notNull().default(0),
  damageFeeDzd: integer('damage_fee_dzd').notNull().default(0),
  fuelCleaningFeeDzd: integer('fuel_cleaning_fee_dzd').notNull().default(0),
  totalAdditionalFeeDzd: integer('total_additional_fee_dzd').notNull().default(0),
  idempotencyKey: text('idempotency_key'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedByRole: text('archived_by_role'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const vehicleDocuments = pgTable(
  'vehicle_documents',
  {
    id: serial('id').primaryKey(),
    vehicleId: integer('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    docType: text('doc_type').notNull(), // 'assurance' | 'controle_technique' | 'carte_grise' | 'vignette' | 'other'
    docName: text('doc_name').notNull(),
    issueDate: text('issue_date').notNull(),
    expiryDate: text('expiry_date').default(''),
    filePath: text('file_path').notNull(),
    mimeType: text('mime_type').notNull(),
    isCurrent: boolean('is_current').notNull().default(true),
    replacedById: integer('replaced_by_id'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedByRole: text('archived_by_role'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('vehicle_docs_vehicle_idx').on(table.vehicleId, table.isCurrent)],
);

export const maintenanceRecords = pgTable(
  'maintenance_records',
  {
    id: serial('id').primaryKey(),
    vehicleId: integer('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    maintenanceType: text('maintenance_type').notNull(), // 'graissage' | 'bougies' | 'kit_chaine' | 'other'
    maintenanceDate: text('maintenance_date').notNull(),
    mileageAtService: integer('mileage_at_service').notNull(),
    nextServiceMileage: integer('next_service_mileage').notNull(),
    costDzd: integer('cost_dzd').notNull().default(0),
    notes: text('notes').default(''),
    status: text('status').notNull().default('in_progress'), // 'in_progress' | 'completed'
    completedAt: timestamp('completed_at', { withTimezone: true }),
    idempotencyKey: text('idempotency_key'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedByRole: text('archived_by_role'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('maintenance_vehicle_idx').on(table.vehicleId, table.status)],
);

export const financialTransactions = pgTable(
  'financial_transactions',
  {
    id: serial('id').primaryKey(),
    txType: text('tx_type').notNull(), // 'rental_payment' | 'deposit_in' | 'deposit_refund' | 'expense' | 'refund' | 'late_extra_fee' | 'cash_withdrawal'
    paymentMethod: text('payment_method').notNull().default('cash'), // 'cash' | 'card' | 'transfer' | 'cheque'
    amountDzd: integer('amount_dzd').notNull(),
    contractId: integer('contract_id').references(() => rentalContracts.id, {
      onDelete: 'set null',
    }),
    vehicleId: integer('vehicle_id').references(() => vehicles.id, { onDelete: 'set null' }),
    maintenanceId: integer('maintenance_id').references(() => maintenanceRecords.id, {
      onDelete: 'set null',
    }),
    category: text('category').notNull().default('Location'),
    description: text('description').default(''),
    txDate: timestamp('tx_date', { withTimezone: true }).defaultNow().notNull(),
    createdByRole: text('created_by_role').notNull().default('manager'),
    idempotencyKey: text('idempotency_key'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedByRole: text('archived_by_role'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('financial_tx_date_idx').on(table.txDate, table.txType)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    audience: text('audience').notNull().default('all'), // 'manager' | 'all'
    severity: text('severity').notNull().default('normal'), // 'normal' | 'warning' | 'urgent'
    category: text('category').notNull(), // 'reservation' | 'return' | 'maintenance' | 'document_expiry' | 'status'
    title: text('title').notNull(),
    message: text('message').notNull(),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>().default({}),
    dedupeKey: text('dedupe_key').unique(),
    isRead: boolean('is_read').notNull().default(false),
    deliveredWindows: boolean('delivered_windows').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('notifications_audience_read_idx').on(table.audience, table.isRead)],
);

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  actorRole: text('actor_role').notNull(),
  actorUid: text('actor_uid').default(''),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').default(''),
  detailsJson: jsonb('details_json').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  valueJson: jsonb('value_json').$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const backupRecords = pgTable('backup_records', {
  id: serial('id').primaryKey(),
  filename: text('filename').notNull(),
  sizeBytes: integer('size_bytes').notNull().default(0),
  recordCountsJson: jsonb('record_counts_json').$type<Record<string, number>>().default({}),
  createdByRole: text('created_by_role').notNull().default('manager'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
