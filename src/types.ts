import type { RentalConditionArticle } from './db/schema.ts';

export interface VehicleItem {
  id: number;
  brand: string;
  model: string;
  year: number;
  color: string;
  registrationNumber: string;
  dailyPriceDzd: number;
  currentMileage: number;
  photoPath: string;
  photoUrl: string;
  fuelType: string;
  transmission: string;
  seats: number;
  chassisNumber?: string;
  engineSeries?: string;
  manualStatus: string;
  computedStatus: 'available' | 'reserved' | 'rented' | 'maintenance';
  availableForRange: boolean;
  activeReservation?: ReservationItem | null;
  activeContract?: ContractItem | null;
  inProgressMaintenance?: MaintenanceItem | null;
  docAlertCount: number;
  maintAlerts: MaintenanceAlertItem[];
  version?: number;
}

export interface VehicleDocumentItem {
  id: number;
  vehicleId: number;
  docType: string;
  docName: string;
  issueDate: string;
  expiryDate: string;
  fileUrl: string;
  mimeType: string;
  isCurrent: boolean;
  uploadedAt: string;
  computed: {
    status: 'permanent' | 'valid' | 'approaching' | 'expired';
    color: 'green' | 'orange' | 'red';
    remainingDays: number | null;
  };
}

export interface CustomerItem {
  id: number;
  fullName: string;
  dateOfBirth: string;
  birthPlace: string;
  phone: string;
  address: string;
  email: string;
  idType: string;
  idNumber: string;
  idIssuedBy: string;
  country: string;
  licenceNumber: string;
  licenceFrontUrl: string | null;
  licenceBackUrl: string | null;
  contractsCount: number;
  reservationsCount: number;
  rentalHistory: ContractItem[];
  version?: number;
}

export interface ReservationItem {
  id: number;
  reservationCode: string;
  vehicleId: number;
  customerId: number;
  startDate: string;
  endDate: string;
  dailyPriceDzd: number;
  totalAmountDzd: number;
  status: string;
  source: string;
  notes: string;
  version: number;
  vehicle?: VehicleItem | null;
  customer?: CustomerItem | null;
}

export interface ReturnItem {
  id: number;
  contractId: number;
  vehicleId: number;
  returnedAt: string;
  returnMileage: number;
  fuelLevel: string;
  conditionNotes: string;
  damageMarkersJson: string[];
  lateHours: number;
  lateFeeDzd: number;
  allowedKm: number;
  drivenKm: number;
  extraKm: number;
  extraKmFeeDzd: number;
  damageFeeDzd: number;
  fuelCleaningFeeDzd: number;
  totalAdditionalFeeDzd: number;
  contract?: ContractItem | null;
  vehicle?: VehicleItem | null;
  customer?: CustomerItem | null;
}

export interface ContractItem {
  id: number;
  contractNumber: string;
  reservationId: number | null;
  vehicleId: number;
  customerId: number;
  driverCustomerId?: number | null;
  driverName: string;
  driverDob: string;
  driverIdNumber: string;
  driverLicenceNumber?: string;
  driverCountry: string;
  driverAddress: string;
  driverPhone: string;
  startAt: string;
  endAt: string;
  durationDays: number;
  dailyPriceDzd: number;
  totalAmountDzd: number;
  depositDzd: number;
  amountPaidDzd: number;
  departureMileage: number;
  departureFuelLevel: string;
  departureNotes: string;
  departureDamageJson: string[];
  status: 'pending' | 'confirmed' | 'completed' | 'upcoming' | 'active' | 'cancelled';
  confirmedAt?: string | null;
  completedAt?: string | null;
  pickupLocation: string;
  returnLocation: string;
  extensionNumber?: string;
  extensionStartAt?: string | null;
  extensionEndAt?: string | null;
  extensionDays?: number;
  extensionFromDate?: string;
  extensionUntilDate?: string;
  extensionExitTime?: string;
  extensionEntryTime?: string;
  earlyReturnDate?: string;
  earlyReturnTime?: string;
  earlyReturnLocation?: string;
  maxMileageLimit?: number | null;
  version: number;
  createdAt: string;
  digitalAccessToken?: string;
  vehicle?: VehicleItem | null;
  customer?: CustomerItem | null;
  driverCustomer?: CustomerItem | null;
  returnRecord?: ReturnItem | null;
}

export interface PublicDigitalContractPayload {
  contract: ContractItem;
  conditionsVersionNumber?: string;
  conditionsArticles: RentalConditionArticle[];
  agency: {
    name: string;
    address: string;
    phones: string[];
    email: string;
    commerceRegister: string;
    nis: string;
  };
}

export interface MaintenanceAlertItem {
  vehicleId?: number;
  vehicleName?: string;
  registrationNumber?: string;
  plate?: string;
  maintenanceType: 'graissage' | 'bougies' | 'kit_chaine';
  intervalKm: number;
  currentMileage: number;
  lastServiceMileage: number | null;
  nextServiceMileage: number;
  remainingKm: number;
  state: 'in_progress' | 'overdue' | 'approaching' | 'ok';
}

export interface MaintenanceItem {
  id: number;
  vehicleId: number;
  maintenanceType: string;
  maintenanceDate: string;
  mileageAtService: number;
  nextServiceMileage: number;
  costDzd: number;
  notes: string;
  status: 'in_progress' | 'completed';
  completedAt: string | null;
  vehicle?: VehicleItem | null;
}

export interface NotificationItem {
  id: number;
  audience: string;
  severity: 'normal' | 'warning' | 'urgent';
  category: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export interface ConditionVersionItem {
  id: number;
  versionNumber: string;
  isPublished: boolean;
  articlesJson: RentalConditionArticle[];
  createdByRole: string;
  createdAt: string;
  acceptancesCount: number;
}

export interface FinancialTransactionItem {
  id: number;
  txType: string;
  paymentMethod: string;
  amountDzd: number;
  contractId: number | null;
  vehicleId: number | null;
  category: string;
  description: string;
  txDate: string;
  createdByRole?: string;
  vehicle?: VehicleItem | null;
  contract?: ContractItem | null;
}

export interface FinanceSummary {
  cashBalance: number;
  totalIncome: number;
  totalDepositsHeld: number;
  totalExpenses: number;
  totalRefunds: number;
  totalWithdrawals: number;
  netProfit: number;
  dailyTotal: number;
  monthlyTotal: number;
}

export interface DeletePermissions {
  employeeCanDeleteVehicles: boolean;
  employeeCanDeleteCustomers: boolean;
  employeeCanDeleteReservations: boolean;
  employeeCanDeleteContracts: boolean;
  employeeCanDeleteDocuments: boolean;
  employeeCanDeleteMaintenance: boolean;
  employeeCanClearNotifications: boolean;
}

export type SyncStatusMode = 'online' | 'offline' | 'syncing' | 'error';
