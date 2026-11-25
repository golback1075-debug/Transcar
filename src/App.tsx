import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CustomerBookingSite } from './components/CustomerBookingSite.tsx';
import { DigitalContractPortal } from './components/DigitalContractPortal.tsx';
import { LoginScreen } from './components/LoginScreen.tsx';
import { NotificationDrawer } from './components/NotificationDrawer.tsx';
import { OfflineIndicator } from './components/OfflineIndicator.tsx';
import { PWAInstallButton } from './components/PWAInstallButton.tsx';
import { PWAUpdateBanner } from './components/PWAUpdateBanner.tsx';
import { OfflineReadyToast } from './components/OfflineReadyToast.tsx';
import { CashRegisterView } from './components/views/CashRegisterView.tsx';
import { CompletedContractsView } from './components/views/CompletedContractsView.tsx';
import { ConditionsView } from './components/views/ConditionsView.tsx';
import { ContractsView } from './components/views/ContractsView.tsx';
import { CustomersView } from './components/views/CustomersView.tsx';
import { DashboardView } from './components/views/DashboardView.tsx';
import { FinancialReportsView } from './components/views/FinancialReportsView.tsx';
import { FleetView } from './components/views/FleetView.tsx';
import { ReservationsView } from './components/views/ReservationsView.tsx';
import { ReturnsAndMaintenanceView } from './components/views/ReturnsAndMaintenanceView.tsx';
import { SettingsBackupView } from './components/views/SettingsBackupView.tsx';
import { TRANSLATIONS, type Lang } from './i18n/translations.ts';
import {
  apiFetch,
  getAuthToken,
  isOfflineToken,
  setAuthToken,
  setOfflineAuthSecret,
  setOnAuthExpired,
  upgradeOfflineSession,
} from './lib/api.ts';
import { initOfflineDb } from './lib/offlineDb.ts';
import { peekNextOfflineContractNumber } from './lib/offlineStore.ts';
import {
  computeSyncStatus,
  flushOfflineQueue,
  setOnSyncAuthExpired,
  subscribeSyncStatus,
  type SyncStatusState,
} from './lib/offlineSync.ts';
import type {
  ContractItem,
  CustomerItem,
  DeletePermissions,
  MaintenanceAlertItem,
  MaintenanceItem,
  NotificationItem,
  ReservationItem,
  ReturnItem,
  VehicleItem,
} from './types.ts';

type AdminTab =
  | 'dashboard'
  | 'fleet'
  | 'reservations'
  | 'contracts'
  | 'customers'
  | 'returns'
  | 'completed'
  | 'maintenance'
  | 'cash'
  | 'reports'
  | 'conditions'
  | 'settings';

interface DashboardPayload {
  stats: {
    totalVehicles: number;
    availableVehicles: number;
    reservedVehicles: number;
    rentedVehicles: number;
    maintenanceVehicles: number;
    totalCustomers: number;
    activeRentals: number;
    overdueReturns: number;
    todayReservations: number;
    todayReturns: number;
    upcomingReturns: number;
    maintenanceAlerts: number;
    documentExpiryAlerts: number;
    unreadNotifications: number;
  };
  recentContracts: ContractItem[];
  financeSummary: {
    dailyRevenue: number;
    monthlyRevenue: number;
    totalRevenue: number;
    totalExpenses: number;
    netProfit: number;
    cashBalance: number;
  } | null;
}

function extractContractTokenFromLocation(): string | null {
  const params = new URLSearchParams(window.location.search);
  const queryToken = params.get('contract');
  if (queryToken && queryToken.trim()) return queryToken.trim();
  const match = /^\/contract\/([^/?#]+)$/i.exec(window.location.pathname);
  if (match && match[1]) {
    try {
      return decodeURIComponent(match[1]).trim();
    } catch {
      return match[1].trim();
    }
  }
  return null;
}

export default function App() {
  const [lang, setLang] = useState<Lang>(() => {
    const saved = localStorage.getItem('transcar_lang');
    return saved === 'ar' || saved === 'en' ? saved : 'fr';
  });

  const [digitalContractToken, setDigitalContractToken] = useState<string | null>(() =>
    extractContractTokenFromLocation(),
  );

  const [isPublicWebsite, setIsPublicWebsite] = useState<boolean>(
    () => window.location.pathname === '/book' || window.location.search.includes('portal=book'),
  );

  const [session, setSession] = useState<{ role: 'manager' | 'employee'; email: string } | null>(
    null,
  );
  const [isOfflineSession, setIsOfflineSession] = useState(false);
  const [sessionTokenTick, setSessionTokenTick] = useState(0);
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');
  const [syncOnline, setSyncOnline] = useState<boolean>(navigator.onLine);
  const [syncState, setSyncState] = useState<SyncStatusState>(() => computeSyncStatus());
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Core data state
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [vehicles, setVehicles] = useState<VehicleItem[]>([]);
  const [customers, setCustomers] = useState<CustomerItem[]>([]);
  const [reservations, setReservations] = useState<ReservationItem[]>([]);
  const [contracts, setContracts] = useState<ContractItem[]>([]);
  const [nextContractNumber, setNextContractNumber] = useState<string>('TRANSCAR-0001');
  const [returns, setReturns] = useState<ReturnItem[]>([]);
  const [maintenanceRecords, setMaintenanceRecords] = useState<MaintenanceItem[]>([]);
  const [maintenanceAlerts, setMaintenanceAlerts] = useState<MaintenanceAlertItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [deletePermissions, setDeletePermissions] = useState<DeletePermissions>({
    employeeCanDeleteVehicles: false,
    employeeCanDeleteCustomers: false,
    employeeCanDeleteReservations: true,
    employeeCanDeleteContracts: false,
    employeeCanDeleteDocuments: false,
    employeeCanDeleteMaintenance: true,
    employeeCanClearNotifications: false,
  });

  // Cross-view prefill helpers
  const [prefillReservation, setPrefillReservation] = useState<ReservationItem | null>(null);
  const [preselectReturnContractId, setPreselectReturnContractId] = useState<number | null>(null);
  const [preselectMaintVehicleId, setPreselectMaintVehicleId] = useState<number | null>(null);

  const lastUnreadCountRef = useRef<number>(0);

  useEffect(() => {
    void initOfflineDb();
    const onPopState = () => {
      setDigitalContractToken(extractContractTokenFromLocation());
      setIsPublicWebsite(
        window.location.pathname === '/book' || window.location.search.includes('portal=book'),
      );
    };
    window.addEventListener('popstate', onPopState);
    const unsubSync = subscribeSyncStatus((st) => setSyncState(st));
    return () => {
      window.removeEventListener('popstate', onPopState);
      unsubSync();
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('transcar_lang', lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  const loadAllData = useCallback(async () => {
    if (!session || !getAuthToken()) return;
    try {
      const results = await Promise.allSettled([
        apiFetch<DashboardPayload>('/api/dashboard'),
        apiFetch<{ vehicles: VehicleItem[] }>('/api/vehicles'),
        apiFetch<{ customers: CustomerItem[] }>('/api/customers'),
        apiFetch<{ reservations: ReservationItem[] }>('/api/reservations'),
        apiFetch<{ contracts: ContractItem[]; nextContractNumber?: string }>('/api/contracts'),
        apiFetch<{ returns: ReturnItem[] }>('/api/returns'),
        apiFetch<{ records: MaintenanceItem[]; alerts: MaintenanceAlertItem[] }>(
          '/api/maintenance',
        ),
        apiFetch<{ notifications: NotificationItem[] }>('/api/notifications'),
        apiFetch<{ permissions: DeletePermissions }>('/api/settings/permissions'),
      ]);

      const [dashR, vehR, custR, resR, ctR, retR, maintR, notifR, permR] = results;

      if (dashR.status === 'fulfilled' && dashR.value) setDashboard(dashR.value);
      if (vehR.status === 'fulfilled' && vehR.value) setVehicles(vehR.value.vehicles || []);
      if (custR.status === 'fulfilled' && custR.value) setCustomers(custR.value.customers || []);
      if (resR.status === 'fulfilled' && resR.value) {
        setReservations(resR.value.reservations || []);
      }
      if (ctR.status === 'fulfilled' && ctR.value) {
        setContracts(ctR.value.contracts || []);
        setNextContractNumber(
          ctR.value.nextContractNumber || peekNextOfflineContractNumber(),
        );
      } else {
        setNextContractNumber(peekNextOfflineContractNumber());
      }
      if (retR.status === 'fulfilled' && retR.value) setReturns(retR.value.returns || []);
      if (maintR.status === 'fulfilled' && maintR.value) {
        setMaintenanceRecords(maintR.value.records || []);
        setMaintenanceAlerts(maintR.value.alerts || []);
      }
      if (permR.status === 'fulfilled' && permR.value?.permissions) {
        setDeletePermissions(permR.value.permissions);
      }
      if (notifR.status === 'fulfilled' && notifR.value) {
        const nextNotifs = notifR.value.notifications || [];
        setNotifications(nextNotifs);
        const unread = nextNotifs.filter((n) => !n.isRead).length;
        if (unread > lastUnreadCountRef.current && window.electronAPI?.notify) {
          const latest = nextNotifs.find((n) => !n.isRead);
          if (latest) {
            window.electronAPI.notify(latest.title, latest.message);
          }
        }
        lastUnreadCountRef.current = unread;
      }

      // Quietly pre-cache secondary tabs & vehicle documents when online so all sections work offline
      if (!isOfflineToken() && navigator.onLine) {
        const extraGets = ['/api/conditions'];
        if (session.role === 'manager') {
          extraGets.push('/api/finance/transactions', '/api/reports/financial');
        }
        if (vehR.status === 'fulfilled' && Array.isArray(vehR.value?.vehicles)) {
          for (const v of vehR.value.vehicles.slice(0, 25)) {
            extraGets.push(`/api/vehicles/${v.id}/documents`);
          }
        }
        void Promise.allSettled(extraGets.map((u) => apiFetch(u)));
      }
    } catch {
      // Errors or offline gaps without cached snapshots keep existing UI state intact
    }
  }, [session]);

  const syncPendingAndReload = useCallback(async () => {
    const token = getAuthToken();
    if (!session || !token) return;

    if (navigator.onLine) {
      if (isOfflineToken()) {
        const upgraded = await upgradeOfflineSession();
        if (upgraded) {
          setIsOfflineSession(false);
          setSessionTokenTick((v) => v + 1);
        }
      }
      const activeToken = getAuthToken();
      if (activeToken && !isOfflineToken()) {
        await flushOfflineQueue(activeToken);
      }
    }
    await loadAllData();
  }, [session, loadAllData]);

  useEffect(() => {
    const onOnline = () => {
      setSyncOnline(true);
      syncPendingAndReload();
    };
    const onOffline = () => setSyncOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [syncPendingAndReload]);

  useEffect(() => {
    if (!session) return;
    syncPendingAndReload();
  }, [session, syncPendingAndReload]);

  // Real-time Server-Sent Events (SSE) synchronization across multiple computers
  useEffect(() => {
    const token = getAuthToken();
    if (!session || !token || isOfflineToken()) return;

    const es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
    es.onopen = () => setSyncOnline(true);
    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed?.type === 'data_changed' || parsed?.type === 'notification') {
          loadAllData();
        }
      } catch {
        // ignore keepalive parse
      }
    };
    es.onerror = () => setSyncOnline(false);
    return () => {
      es.close();
    };
  }, [session, loadAllData, sessionTokenTick]);

  const handleLogout = useCallback(() => {
    setAuthToken(null);
    setOfflineAuthSecret(null);
    setIsOfflineSession(false);
    setSession(null);
    setActiveTab('dashboard');
    lastUnreadCountRef.current = 0;
  }, []);

  useEffect(() => {
    const onExpired = () => {
      handleLogout();
    };
    setOnAuthExpired(onExpired);
    setOnSyncAuthExpired(onExpired);
    return () => {
      setOnAuthExpired(null);
      setOnSyncAuthExpired(null);
    };
  }, [handleLogout]);

  if (digitalContractToken) {
    return (
      <>
        <DigitalContractPortal
          token={digitalContractToken}
          initialLang={lang}
          onChangeLang={setLang}
          onOpenBookingSite={() => {
            setDigitalContractToken(null);
            setIsPublicWebsite(true);
            window.history.pushState({}, '', '/book');
          }}
          onOpenAgencyLogin={() => {
            setDigitalContractToken(null);
            setIsPublicWebsite(false);
            window.history.pushState({}, '', '/');
          }}
        />
        <PWAUpdateBanner lang={lang} />
      </>
    );
  }

  if (isPublicWebsite) {
    return (
      <CustomerBookingSite
        initialLang={lang}
        onOpenAgencyLogin={() => {
          setIsPublicWebsite(false);
          if (window.location.pathname === '/book') {
            window.history.pushState({}, '', '/');
          }
        }}
      />
    );
  }

  if (!session) {
    return (
      <>
        <LoginScreen
          lang={lang}
          onChangeLang={setLang}
          onSuccess={(role, email, offlineMode) => {
            setIsOfflineSession(Boolean(offlineMode));
            setSession({ role, email });
            setSessionTokenTick((v) => v + 1);
            setActiveTab('dashboard');
          }}
          onOpenCustomerPortal={() => {
            setIsPublicWebsite(true);
            window.history.pushState({}, '', '/book');
          }}
        />
        <PWAUpdateBanner lang={lang} />
      </>
    );
  }

  const t = TRANSLATIONS[lang];
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const navItems: Array<{
    id: AdminTab;
    label: string;
    icon: string;
    managerOnly?: boolean;
  }> = [
    { id: 'dashboard', label: t.navDashboard, icon: 'dashboard' },
    { id: 'fleet', label: t.navFleet, icon: 'garage' },
    { id: 'reservations', label: t.navReservations, icon: 'event_available' },
    { id: 'contracts', label: t.navContracts, icon: 'description' },
    { id: 'customers', label: t.navCustomers, icon: 'group' },
    { id: 'returns', label: t.navReturns, icon: 'assignment_return' },
    { id: 'completed', label: t.navCompleted, icon: 'task_alt' },
    { id: 'maintenance', label: t.navMaintenance, icon: 'build' },
    { id: 'cash', label: t.navCash, icon: 'point_of_sale', managerOnly: true },
    { id: 'reports', label: t.navReports, icon: 'bar_chart', managerOnly: true },
    { id: 'conditions', label: t.navConditions, icon: 'gavel' },
    { id: 'settings', label: t.navSettings, icon: 'settings_backup_restore', managerOnly: true },
  ];

  const visibleNav = navItems.filter(
    (item) => !item.managerOnly || session.role === 'manager',
  );

  const currentNav = visibleNav.find((n) => n.id === activeTab) || visibleNav[0];

  return (
    <div className="app-print-shell min-h-screen flex bg-[#FBF8FC] text-[#1B1B1E]">
      {/* Shared App Shell Sidebar */}
      <aside className="no-print w-64 shrink-0 min-h-screen bg-[#111114] text-white flex flex-col justify-between border-r border-[#303033]">
        <div className="p-6 flex flex-col gap-6">
          <div className="flex items-center gap-3 pb-4 border-b border-[#303033]">
            <div className="w-9 h-9 rounded bg-[#93000B] flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[20px] text-white">
                directions_car
              </span>
            </div>
            <div>
              <span className="font-headline text-[15px] font-bold text-white block">
                {t.appTitle}
              </span>
              <span className="font-label text-[11px] text-[#DCD9DD] block">
                {t.locationBlida} ·{' '}
                {session.role === 'manager' ? t.roleManager : t.roleEmployee}
              </span>
            </div>
          </div>

          <nav aria-label="Navigation principale" className="flex flex-col gap-1">
            {visibleNav.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded text-left transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#93000B] text-white'
                      : 'text-[#DCD9DD] hover:bg-[#303033] hover:text-white'
                  }`}
                >
                  <span className="material-symbols-outlined text-[20px] shrink-0">
                    {item.icon}
                  </span>
                  <span className="font-label text-[13px] font-semibold truncate">
                    {item.label}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-6 border-t border-[#303033] flex flex-col gap-3">
          <button
            type="button"
            onClick={() => {
              setIsPublicWebsite(true);
              window.history.pushState({}, '', '/book');
            }}
            className="flex items-center gap-2 px-3 py-2 rounded bg-[#303033] text-[#F3F0F4] hover:bg-[#3f3f44] text-[12px] font-semibold cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">public</span>
            <span>{t.portalWebsite}</span>
          </button>

          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 font-label text-[11px] text-[#DCD9DD]">
              <span
                className={`w-2 h-2 rounded-full ${
                  !syncOnline || syncState.mode === 'offline'
                    ? 'bg-[#D97706]'
                    : syncState.mode === 'error'
                      ? 'bg-[#BA1A1A]'
                      : syncState.mode === 'syncing'
                        ? 'bg-[#38BDF8] animate-pulse'
                        : 'bg-[#15803D]'
                }`}
              />
              {!syncOnline || syncState.mode === 'offline'
                ? t.offline
                : syncState.mode === 'error'
                  ? `Erreur synchro (${syncState.errorCount})`
                  : syncState.mode === 'syncing'
                    ? `Synchro (${syncState.pendingCount})...`
                    : t.synced}
            </span>
            <span className="font-mono text-[11px] font-semibold text-[#DCD9DD] uppercase">
              {lang}
            </span>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-2 px-3 py-2 rounded text-[#DCD9DD] hover:bg-[#303033] hover:text-white transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">logout</span>
            <span className="font-label text-[13px] font-semibold">{t.lockSession}</span>
          </button>
        </div>
      </aside>

      {/* Main Workspace */}
      <div className="app-print-main flex-1 flex flex-col min-w-0">
        <header className="no-print bg-white border-b border-[#E4BEB9] px-6 py-4 flex items-center justify-between gap-4 sticky top-0 z-20">
          <div>
            <h1 className="font-headline text-[22px] font-semibold text-[#1B1B1E]">
              {currentNav.label}
            </h1>
            <p className="text-[13px] text-[#5B403D]">
              TRANSCAR · {t.locationBlida}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <PWAInstallButton lang={lang} />
            {/* Language Switcher FR / AR / EN */}
            <div className="flex items-center rounded border border-[#E4BEB9] overflow-hidden bg-[#F6F2F7]">
              {(['fr', 'ar', 'en'] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setLang(code)}
                  className={`px-2.5 py-1.5 font-mono text-[12px] font-semibold uppercase cursor-pointer ${
                    lang === code
                      ? 'bg-[#111114] text-white'
                      : 'text-[#5B403D] hover:bg-[#EAE7EB]'
                  }`}
                >
                  {code}
                </button>
              ))}
            </div>

            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#F0EDF1] text-[#1B1B1E] font-label text-[11px] font-semibold">
              <span className="material-symbols-outlined text-[16px] text-[#93000B]">
                {session.role === 'manager' ? 'admin_panel_settings' : 'badge'}
              </span>
              {session.role === 'manager' ? t.managerMode : t.employeeMode}
              {isOfflineSession ? ` · ${t.offlineSessionBadge}` : ''}
            </span>

            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label={t.notificationsCenter}
              className="relative inline-flex items-center justify-center w-10 h-10 rounded bg-white text-[#1B1B1E] border border-[#E4BEB9] hover:bg-[#F0EDF1] cursor-pointer"
            >
              <span className="material-symbols-outlined text-[20px]">notifications</span>
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-[#93000B] text-white font-label text-[11px] font-semibold tabular-nums">
                  {unreadCount}
                </span>
              )}
            </button>
          </div>
        </header>

        <main className="app-print-main p-6 flex-1">
          {activeTab === 'dashboard' && (
            <DashboardView
              lang={lang}
              role={session.role}
              data={dashboard}
              notifications={notifications}
              onNavigate={(tab) => setActiveTab(tab as AdminTab)}
            />
          )}

          {activeTab === 'fleet' && (
            <FleetView
              lang={lang}
              role={session.role}
              canDeleteVehicles={
                session.role === 'manager' || deletePermissions.employeeCanDeleteVehicles
              }
              canDeleteDocuments={
                session.role === 'manager' || deletePermissions.employeeCanDeleteDocuments
              }
              vehicles={vehicles}
              onRefresh={loadAllData}
              onGoToMaintenance={(vid) => {
                setPreselectMaintVehicleId(vid);
                setActiveTab('maintenance');
              }}
              onGoToReturn={(cid) => {
                setPreselectReturnContractId(cid);
                setActiveTab('returns');
              }}
            />
          )}

          {activeTab === 'reservations' && (
            <ReservationsView
              reservations={reservations}
              vehicles={vehicles}
              customers={customers}
              canDeleteReservations={
                session.role === 'manager' || deletePermissions.employeeCanDeleteReservations
              }
              onRefresh={loadAllData}
              onConvertToContract={(resItem) => {
                setPrefillReservation(resItem);
                setActiveTab('contracts');
              }}
            />
          )}

          {activeTab === 'contracts' && (
            <ContractsView
              lang={lang}
              role={session.role}
              canDeleteContracts={
                session.role === 'manager' || deletePermissions.employeeCanDeleteContracts
              }
              contracts={contracts}
              nextContractNumber={nextContractNumber}
              vehicles={vehicles}
              customers={customers}
              prefillReservation={prefillReservation}
              onClearPrefill={() => setPrefillReservation(null)}
              onRefresh={loadAllData}
            />
          )}

          {activeTab === 'customers' && (
            <CustomersView
              lang={lang}
              canDeleteCustomers={
                session.role === 'manager' || deletePermissions.employeeCanDeleteCustomers
              }
              canDeleteDocuments={
                session.role === 'manager' || deletePermissions.employeeCanDeleteDocuments
              }
              customers={customers}
              onRefresh={loadAllData}
            />
          )}

          {(activeTab === 'returns' || activeTab === 'maintenance') && (
            <ReturnsAndMaintenanceView
              lang={lang}
              canDeleteMaintenance={
                session.role === 'manager' || deletePermissions.employeeCanDeleteMaintenance
              }
              contracts={contracts}
              vehicles={vehicles}
              returns={returns}
              maintenanceRecords={maintenanceRecords}
              maintenanceAlerts={maintenanceAlerts}
              preselectedContractId={preselectReturnContractId}
              preselectedVehicleId={preselectMaintVehicleId}
              onClearPreselect={() => {
                setPreselectReturnContractId(null);
                setPreselectMaintVehicleId(null);
              }}
              onRefresh={loadAllData}
            />
          )}

          {activeTab === 'completed' && (
            <CompletedContractsView
              lang={lang}
              role={session.role}
              contracts={contracts}
              customers={customers}
              onRefresh={loadAllData}
            />
          )}

          {activeTab === 'cash' && session.role === 'manager' && (
            <CashRegisterView lang={lang} role={session.role} vehicles={vehicles} />
          )}

          {activeTab === 'reports' && session.role === 'manager' && (
            <FinancialReportsView lang={lang} />
          )}

          {activeTab === 'conditions' && (
            <ConditionsView lang={lang} role={session.role} />
          )}

          {activeTab === 'settings' && session.role === 'manager' && (
            <SettingsBackupView
              lang={lang}
              onRefreshAll={loadAllData}
              permissions={deletePermissions}
              onPermissionsChange={setDeletePermissions}
            />
          )}
        </main>
      </div>

      <NotificationDrawer
        open={drawerOpen}
        notifications={notifications}
        canDeleteNotifications={
          session.role === 'manager' || deletePermissions.employeeCanClearNotifications
        }
        onClose={() => setDrawerOpen(false)}
        onMarkRead={async (id) => {
          await apiFetch(`/api/notifications/${id}/read`, { method: 'POST' });
          loadAllData();
        }}
        onMarkAllRead={async () => {
          await apiFetch('/api/notifications/read-all', { method: 'POST' });
          loadAllData();
        }}
        onDeleteNotification={async (id) => {
          await apiFetch(`/api/notifications/${id}`, { method: 'DELETE' });
          loadAllData();
        }}
        onClearAllNotifications={async () => {
          await apiFetch('/api/notifications', { method: 'DELETE' });
          loadAllData();
        }}
        onRunChecks={async () => {
          await apiFetch('/api/notifications/run-checks', { method: 'POST' });
          loadAllData();
        }}
      />
      <OfflineIndicator lang={lang} onSyncNow={syncPendingAndReload} />
      <PWAUpdateBanner lang={lang} />
      <OfflineReadyToast lang={lang} />
    </div>
  );
}
