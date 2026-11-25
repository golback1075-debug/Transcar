import React, { useEffect, useRef, useState } from 'react';
import { TRANSLATIONS, type Lang } from '../../i18n/translations.ts';
import { apiFetch, authorizedFileUrl, formatDateTime } from '../../lib/api.ts';
import { saveOfflineCredential } from '../../lib/offlineAuth.ts';
import {
  applyUpdateNow,
  checkForUpdates,
  getPwaUpdateState,
  subscribePwaUpdate,
  type PwaUpdateState,
} from '../../lib/pwaUpdater.ts';
import { usePWAInstall } from '../../hooks/usePWAInstall.ts';
import type { DeletePermissions } from '../../types.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { PWAInstallButton } from '../PWAInstallButton.tsx';

interface BackupRecord {
  id: number;
  filename: string;
  sizeBytes: number;
  triggerType: string;
  createdByRole: string;
  createdAt: string;
}

interface AuditLogRecord {
  id: number;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
}

interface Props {
  lang?: Lang;
  onRefreshAll: () => void | Promise<void>;
  permissions?: DeletePermissions;
  onPermissionsChange?: (perms: DeletePermissions) => void;
}

const DEFAULT_PERMS: DeletePermissions = {
  employeeCanDeleteVehicles: false,
  employeeCanDeleteCustomers: false,
  employeeCanDeleteReservations: true,
  employeeCanDeleteContracts: false,
  employeeCanDeleteDocuments: false,
  employeeCanDeleteMaintenance: true,
  employeeCanClearNotifications: false,
};

export const SettingsBackupView: React.FC<Props> = ({
  lang = 'fr',
  onRefreshAll,
  permissions: initialPerms,
  onPermissionsChange,
}) => {
  const t = TRANSLATIONS[lang];
  const [updateState, setUpdateState] = useState<PwaUpdateState>(() => getPwaUpdateState());
  const { isInstalled } = usePWAInstall();
  const [copiedOfficialUrl, setCopiedOfficialUrl] = useState(false);
  const [unsavedUpdateConfirm, setUnsavedUpdateConfirm] = useState(false);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [perms, setPerms] = useState<DeletePermissions>(initialPerms || DEFAULT_PERMS);
  const [savingPerms, setSavingPerms] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const restoreInputRef = useRef<HTMLInputElement>(null);

  // Backup delete confirmation
  const [confirmBackup, setConfirmBackup] = useState<BackupRecord | null>(null);
  const [deletingBackup, setDeletingBackup] = useState(false);

  // Password Management State
  const [targetRole, setTargetRole] = useState<'manager' | 'employee'>('employee');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const loadData = async () => {
    try {
      const [bRes, aRes, pRes] = await Promise.all([
        apiFetch<{ backups: BackupRecord[] }>('/api/backups'),
        apiFetch<{ logs: AuditLogRecord[] }>('/api/audit-logs'),
        apiFetch<{ permissions: DeletePermissions }>('/api/settings/permissions'),
      ]);
      setBackups(bRes.backups);
      setLogs(aRes.logs);
      if (pRes?.permissions) {
        setPerms(pRes.permissions);
        onPermissionsChange?.(pRes.permissions);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur de chargement des paramètres');
    }
  };

  useEffect(() => {
    loadData();
    return subscribePwaUpdate(setUpdateState);
  }, []);

  const handleTogglePermission = async (key: keyof DeletePermissions) => {
    const updated: DeletePermissions = { ...perms, [key]: !perms[key] };
    setPerms(updated);
    setSavingPerms(true);
    setErrorMsg('');
    setStatusMsg('');
    try {
      const res = await apiFetch<{ permissions: DeletePermissions }>('/api/settings/permissions', {
        method: 'PUT',
        body: JSON.stringify(updated),
      });
      const finalPerms = res.permissions || updated;
      setPerms(finalPerms);
      onPermissionsChange?.(finalPerms);
      setStatusMsg('Permissions de suppression Employé mises à jour.');
    } catch (err) {
      setPerms(perms);
      setErrorMsg(err instanceof Error ? err.message : 'Erreur mise à jour permissions');
    } finally {
      setSavingPerms(false);
    }
  };

  const handleCreateBackup = async () => {
    setCreatingBackup(true);
    setErrorMsg('');
    setStatusMsg('');
    try {
      const res = await apiFetch<{ backup: BackupRecord }>('/api/backups', {
        method: 'POST',
      });
      setStatusMsg(`Sauvegarde complète créée : ${res.backup.filename}`);
      await loadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur création sauvegarde');
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleDeleteBackup = async () => {
    if (!confirmBackup) return;
    setDeletingBackup(true);
    setErrorMsg('');
    setStatusMsg('');
    try {
      await apiFetch(`/api/backups/${confirmBackup.id}`, { method: 'DELETE' });
      setStatusMsg(`Sauvegarde ${confirmBackup.filename} supprimée.`);
      await loadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur suppression sauvegarde');
    } finally {
      setDeletingBackup(false);
      setConfirmBackup(null);
    }
  };

  const handleRestoreUpload = async (file: File | null) => {
    if (!file) return;
    setRestoring(true);
    setErrorMsg('');
    setStatusMsg('');
    try {
      const fd = new FormData();
      fd.append('archive', file);
      await apiFetch('/api/backups/restore', {
        method: 'POST',
        body: fd,
      });
      setStatusMsg('Base de données et documents restaurés avec succès.');
      await loadData();
      await onRefreshAll();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur restauration');
    } finally {
      setRestoring(false);
      if (restoreInputRef.current) restoreInputRef.current.value = '';
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setStatusMsg('');
    if (newPassword.length < 4) {
      setErrorMsg('Le nouveau code doit contenir au moins 4 caractères.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('Les mots de passe ne correspondent pas.');
      return;
    }
    setSavingPassword(true);
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ targetRole, newPassword }),
      });
      await saveOfflineCredential(newPassword, targetRole, `${targetRole}@transcar.dz`);
      setNewPassword('');
      setConfirmPassword('');
      setStatusMsg(
        `Mot de passe ${targetRole === 'manager' ? 'Gérant' : 'Employé'} mis à jour avec succès.`,
      );
      await loadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur mise à jour mot de passe');
    } finally {
      setSavingPassword(false);
    }
  };

  const permissionItems: Array<{ key: keyof DeletePermissions; label: string; desc: string }> = [
    {
      key: 'employeeCanDeleteReservations',
      label: 'Supprimer des réservations',
      desc: 'Autorise les employés à supprimer les réservations non liées à un contrat actif',
    },
    {
      key: 'employeeCanDeleteMaintenance',
      label: 'Supprimer des fiches d’entretien',
      desc: 'Archivage automatique si une dépense financière est rattachée',
    },
    {
      key: 'employeeCanDeleteCustomers',
      label: 'Supprimer / archiver des clients',
      desc: 'Bloqué côté serveur si le client possède un contrat actif',
    },
    {
      key: 'employeeCanDeleteVehicles',
      label: 'Supprimer / archiver des véhicules',
      desc: 'Bloqué côté serveur si le véhicule a une location en cours',
    },
    {
      key: 'employeeCanDeleteContracts',
      label: 'Supprimer / archiver des contrats',
      desc: 'Les contrats terminés ou payés sont archivés de façon sécurisée',
    },
    {
      key: 'employeeCanDeleteDocuments',
      label: 'Supprimer des documents & permis',
      desc: 'Documents véhicule (assurance, CT...) et fichiers permis de conduire',
    },
    {
      key: 'employeeCanClearNotifications',
      label: 'Supprimer / effacer les notifications',
      desc: 'Concerne uniquement les notifications visibles par les employés',
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {statusMsg && (
        <div className="p-3 rounded-lg bg-[#DCFCE7] text-[#14532D] border border-[#15803D]/20 text-[13px]">
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div className="p-3 rounded-lg bg-[#FFDAD6] text-[#93000A] border border-[#BA1A1A]/20 text-[13px]">
          {errorMsg}
        </div>
      )}

      {/* Application Updates Section */}
      <section
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
        className="bg-white border border-[#E4BEB9] rounded-lg p-6 flex flex-col gap-4"
      >
        <header className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E4BEB9]">
          <div>
            <h2 className="font-title text-[18px] font-semibold text-[#1B1B1E] flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] text-[#93000B]">
                system_update
              </span>
              <span>{t.appUpdatesTitle}</span>
            </h2>
            <p className="text-[12px] text-[#5B403D]">{t.appUpdatesDesc}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={
                updateState.status === 'checking' ||
                updateState.status === 'downloading' ||
                updateState.status === 'updating'
              }
              onClick={() => {
                void checkForUpdates({ silent: false });
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded border border-[#E4BEB9] bg-white text-[#1B1B1E] hover:bg-[#F6F2F7] text-[13px] font-semibold cursor-pointer disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">
                {updateState.status === 'checking' ? 'sync' : 'refresh'}
              </span>
              <span>{t.checkForUpdates}</span>
            </button>

            {updateState.updateReady && (
              <button
                type="button"
                disabled={
                  updateState.status === 'updating' ||
                  (updateState.status === 'offline' && !updateState.hasWaitingWorker)
                }
                onClick={async () => {
                  const res = await applyUpdateNow({ forceWithUnsavedWork: unsavedUpdateConfirm });
                  if (!res.ok && res.reason === 'unsaved-work') {
                    setUnsavedUpdateConfirm(true);
                  } else if (res.ok) {
                    setUnsavedUpdateConfirm(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-[#93000B] text-white hover:bg-[#B91C1C] text-[13px] font-semibold cursor-pointer disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[18px]">download_done</span>
                <span>
                  {updateState.status === 'updating'
                    ? t.updateStatusUpdating
                    : unsavedUpdateConfirm
                      ? t.confirmUpdateAnyway
                      : t.updateNow}
                </span>
              </button>
            )}
          </div>
        </header>

        {unsavedUpdateConfirm && (
          <div className="p-3 rounded-lg bg-[#FEF3C7] border border-[#B45309]/30 text-[12px] text-[#78350F]">
            {t.unsavedWorkWarning}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-lg border border-[#E4BEB9] bg-[#F6F2F7]/60">
            <span className="font-label text-[11px] font-semibold text-[#5B403D] block">
              {t.currentInstalledVersion}
            </span>
            <span className="font-mono text-[16px] font-bold text-[#1B1B1E] mt-1 block">
              v{updateState.currentVersion}
            </span>
          </div>

          <div className="p-3.5 rounded-lg border border-[#E4BEB9] bg-[#F6F2F7]/60">
            <span className="font-label text-[11px] font-semibold text-[#5B403D] block">
              {t.latestAvailableVersion}
            </span>
            <span
              className={`font-mono text-[16px] font-bold mt-1 block ${
                updateState.hasNewerRemoteVersion ? 'text-[#93000B]' : 'text-[#1B1B1E]'
              }`}
            >
              v{updateState.latestVersion}
            </span>
          </div>

          <div className="p-3.5 rounded-lg border border-[#E4BEB9] bg-[#F6F2F7]/60">
            <span className="font-label text-[11px] font-semibold text-[#5B403D] block">
              {t.lastSuccessfulUpdate}
            </span>
            <span className="text-[13px] font-semibold text-[#1B1B1E] mt-1 block tabular-nums">
              {updateState.lastUpdatedAt
                ? formatDateTime(updateState.lastUpdatedAt)
                : t.neverUpdatedYet}
            </span>
          </div>

          <div className="p-3.5 rounded-lg border border-[#E4BEB9] bg-[#F6F2F7]/60">
            <span className="font-label text-[11px] font-semibold text-[#5B403D] block">
              {t.updateStatusLabel}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 mt-1 px-2.5 py-0.5 rounded-full text-[12px] font-semibold ${
                updateState.status === 'ready'
                  ? 'bg-[#DCFCE7] text-[#14532D]'
                  : updateState.status === 'offline'
                    ? 'bg-[#FEF3C7] text-[#92400E]'
                    : updateState.status === 'error'
                      ? 'bg-[#FFDAD6] text-[#93000A]'
                      : 'bg-white text-[#1B1B1E] border border-[#E4BEB9]'
              }`}
            >
              {updateState.status === 'checking'
                ? t.updateStatusChecking
                : updateState.status === 'downloading'
                  ? t.updateStatusDownloading
                  : updateState.status === 'ready'
                    ? t.updateStatusReady
                    : updateState.status === 'offline'
                      ? t.updateStatusOffline
                      : updateState.status === 'updating'
                        ? t.updateStatusUpdating
                        : updateState.status === 'error'
                          ? t.updateStatusError
                          : t.updateStatusUpToDate}
            </span>
            {updateState.lastCheckedAt && (
              <span className="text-[11px] text-[#5B403D] block mt-1 tabular-nums">
                {t.lastCheckedLabel}: {formatDateTime(updateState.lastCheckedAt)}
              </span>
            )}
          </div>
        </div>

        {(updateState.releaseNotes[lang]?.length || 0) > 0 && (
          <div className="p-3.5 rounded-lg border border-[#E4BEB9] bg-[#FBF8FC]">
            <span className="font-label text-[12px] font-semibold text-[#1B1B1E] block mb-1.5">
              {t.releaseNotesTitle} (v{updateState.latestVersion})
            </span>
            <ul className="list-disc list-inside text-[12px] text-[#5B403D] space-y-1">
              {updateState.releaseNotes[lang].map((note, idx) => (
                <li key={idx}>{note}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="p-3 rounded-lg bg-[#F6F2F7] border border-[#E4BEB9] flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="font-label text-[12px] font-semibold text-[#1B1B1E] block">
              {t.pwaWindowsTitle}
            </span>
            <span className="text-[12px] text-[#5B403D] block">
              {isInstalled ? t.pwaStandaloneActive : t.pwaBrowserMode}
            </span>
            {typeof window !== 'undefined' && (
              <code className="font-mono text-[11px] text-[#93000B] break-all">
                {window.location.origin}
              </code>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                if (typeof window === 'undefined' || !navigator.clipboard?.writeText) return;
                await navigator.clipboard.writeText(window.location.origin).catch(() => {});
                setCopiedOfficialUrl(true);
                window.setTimeout(() => setCopiedOfficialUrl(false), 2000);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#E4BEB9] bg-white text-[#1B1B1E] hover:bg-[#EAE7EB] text-[12px] font-semibold cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">content_copy</span>
              <span>{copiedOfficialUrl ? t.linkCopied : t.copyOfficialLink}</span>
            </button>
            {!isInstalled && <PWAInstallButton lang={lang} />}
          </div>
        </div>

        <div className="p-3 rounded-lg bg-[#DCFCE7]/50 border border-[#15803D]/20 text-[12px] text-[#14532D] flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] shrink-0">verified_user</span>
          <span>
            {t.updateDataSafeNote}
            {updateState.pendingOfflineChangesCount > 0
              ? ` (${updateState.pendingOfflineChangesCount} ${t.offlineQueuePreservedNote})`
              : ''}
          </span>
        </div>
      </section>

      {/* Employee Delete Permissions Section */}
      <section className="bg-white border border-[#E4BEB9] rounded-lg p-6 flex flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E4BEB9]">
          <div>
            <h2 className="font-title text-[18px] font-semibold text-[#1B1B1E]">
              Permissions de suppression (Contrôle Gérant)
            </h2>
            <p className="text-[12px] text-[#5B403D]">
              Définissez les catégories que les employés sont autorisés à supprimer (vérifié côté serveur). Les opérations financières, retraits, sauvegardes et conditions restent strictement réservées au Gérant.
            </p>
          </div>
          {savingPerms && (
            <span className="text-[12px] font-semibold text-[#93000B]">Enregistrement...</span>
          )}
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {permissionItems.map((item) => {
            const enabled = perms[item.key];
            return (
              <label
                key={item.key}
                className="p-3.5 rounded-lg border border-[#E4BEB9] bg-[#F6F2F7]/60 flex items-start justify-between gap-3 cursor-pointer hover:bg-[#F6F2F7]"
              >
                <div>
                  <span className="font-label text-[13px] font-semibold text-[#1B1B1E] block">
                    {item.label}
                  </span>
                  <span className="text-[12px] text-[#5B403D]">{item.desc}</span>
                </div>
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={savingPerms}
                  onChange={() => handleTogglePermission(item.key)}
                  className="mt-1 h-4 w-4 accent-[#93000B] cursor-pointer"
                />
              </label>
            );
          })}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Full Backup & Restore */}
        <section className="lg:col-span-7 bg-white border border-[#E4BEB9] rounded-lg p-6 flex flex-col gap-4">
          <header className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E4BEB9]">
            <div>
              <h2 className="font-title text-[18px] font-semibold text-[#1B1B1E]">
                Sauvegardes complètes (ZIP : PostgreSQL + Documents)
              </h2>
              <p className="text-[12px] text-[#5B403D]">
                Sauvegarde automatique quotidienne à 02h00 · Export et restauration manuelle
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={restoreInputRef}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                onChange={(e) => handleRestoreUpload(e.target.files?.[0] || null)}
              />
              <button
                type="button"
                disabled={restoring}
                onClick={() => restoreInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded border border-[#E4BEB9] text-[#1B1B1E] hover:bg-[#F6F2F7] text-[13px] font-semibold cursor-pointer disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[18px]">restore</span>
                {restoring ? 'Restauration...' : 'Restaurer (.zip)'}
              </button>
              <button
                type="button"
                disabled={creatingBackup}
                onClick={handleCreateBackup}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-[#93000B] text-white hover:bg-[#B91C1C] text-[13px] font-semibold cursor-pointer disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[18px]">backup</span>
                {creatingBackup ? 'Création...' : 'Créer une sauvegarde'}
              </button>
            </div>
          </header>

          <div className="divide-y divide-[#E4BEB9] max-h-72 overflow-y-auto">
            {backups.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-[#5B403D]">
                Aucune sauvegarde générée pour le moment.
              </p>
            ) : (
              backups.map((b) => (
                <div key={b.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="font-mono text-[13px] font-semibold text-[#1B1B1E] block">
                      {b.filename}
                    </span>
                    <span className="text-[12px] text-[#5B403D] tabular-nums">
                      {formatDateTime(b.createdAt)} · {(b.sizeBytes / 1024).toFixed(1)} Ko ·{' '}
                      {b.triggerType}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href={authorizedFileUrl(`/api/backups/${b.id}/download`)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-[#E4BEB9] text-[#1B1B1E] hover:bg-[#F6F2F7] text-[12px] font-semibold"
                    >
                      <span className="material-symbols-outlined text-[16px]">download</span>
                      Télécharger
                    </a>
                    <button
                      type="button"
                      onClick={() => setConfirmBackup(b)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-[#BA1A1A] text-[#BA1A1A] hover:bg-[#FFDAD6] text-[12px] font-semibold cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[15px]">delete</span>
                      Supprimer
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Change Manager / Employee Passwords */}
        <section className="lg:col-span-5 bg-white border border-[#E4BEB9] rounded-lg p-6 flex flex-col gap-4">
          <header className="pb-3 border-b border-[#E4BEB9]">
            <h2 className="font-title text-[18px] font-semibold text-[#1B1B1E]">
              Gestion des codes d'accès
            </h2>
            <p className="text-[12px] text-[#5B403D]">
              Modifiez le mot de passe Gérant ou Employé à tout moment
            </p>
          </header>

          <form noValidate onSubmit={handleChangePassword} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="font-label text-[12px] font-semibold">Rôle cible</span>
              <select
                value={targetRole}
                onChange={(e) => setTargetRole(e.target.value as 'manager' | 'employee')}
                className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
              >
                <option value="employee">Employé (Opérations)</option>
                <option value="manager">Gérant (Administration complète)</option>
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-label text-[12px] font-semibold">Nouveau code d'accès</span>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimum 4 caractères"
                className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-label text-[12px] font-semibold">Confirmer le code</span>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Ressaisir le code"
                className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
              />
            </label>

            <button
              type="submit"
              disabled={savingPassword}
              className="mt-2 py-2.5 rounded bg-[#111114] text-white hover:bg-[#303033] font-label text-[13px] font-semibold cursor-pointer disabled:opacity-50"
            >
              {savingPassword ? 'Mise à jour...' : 'Mettre à jour le code'}
            </button>
          </form>
        </section>
      </div>

      {/* Audit Log Table */}
      <section className="bg-white border border-[#E4BEB9] rounded-lg overflow-hidden">
        <header className="px-5 py-4 border-b border-[#E4BEB9] bg-[#F6F2F7]">
          <h2 className="font-title text-[16px] font-semibold text-[#1B1B1E]">
            Journal d'audit système (100 dernières actions)
          </h2>
        </header>
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-[#F6F2F7] border-b border-[#E4BEB9]">
              <tr>
                <th className="px-4 py-2.5 text-[11px] font-semibold text-[#5B403D] uppercase">
                  Horodatage
                </th>
                <th className="px-4 py-2.5 text-[11px] font-semibold text-[#5B403D] uppercase">
                  Rôle
                </th>
                <th className="px-4 py-2.5 text-[11px] font-semibold text-[#5B403D] uppercase">
                  Action
                </th>
                <th className="px-4 py-2.5 text-[11px] font-semibold text-[#5B403D] uppercase">
                  Entité
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4BEB9] text-[12px]">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-[#5B403D]">
                    Aucune entrée d'audit.
                  </td>
                </tr>
              ) : (
                logs.map((l) => (
                  <tr key={l.id} className="hover:bg-[#F6F2F7]">
                    <td className="px-4 py-2.5 tabular-nums text-[#5B403D]">
                      {formatDateTime(l.createdAt)}
                    </td>
                    <td className="px-4 py-2.5 font-semibold uppercase">{l.actorRole}</td>
                    <td className="px-4 py-2.5 font-mono">{l.action}</td>
                    <td className="px-4 py-2.5 text-[#5B403D]">
                      {l.entityType} #{l.entityId}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <ConfirmDialog
        open={Boolean(confirmBackup)}
        title="Supprimer ce fichier de sauvegarde ?"
        targetLabel={confirmBackup?.filename}
        message="L'archive ZIP sélectionnée sera définitivement supprimée du serveur."
        confirmText="Supprimer"
        loading={deletingBackup}
        onConfirm={handleDeleteBackup}
        onCancel={() => setConfirmBackup(null)}
      />
    </div>
  );
};
