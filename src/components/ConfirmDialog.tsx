import React from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  targetLabel?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  targetLabel,
  confirmText = 'Supprimer',
  cancelText = 'Annuler',
  danger = true,
  loading = false,
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white w-full max-w-md rounded-xl border border-[#E4BEB9] shadow-2xl overflow-hidden"
      >
        <div className="p-5 border-b border-[#E4BEB9] flex items-start gap-3">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
              danger ? 'bg-[#FFDAD6] text-[#93000B]' : 'bg-[#F6F2F7] text-[#1B1B1E]'
            }`}
          >
            <span className="material-symbols-outlined text-[22px]">
              {danger ? 'warning' : 'help'}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-title text-[16px] font-semibold text-[#1B1B1E]">{title}</h3>
            {targetLabel && (
              <p className="mt-1 inline-block px-2.5 py-0.5 rounded bg-[#F6F2F7] border border-[#E4BEB9] font-label text-[12px] font-semibold text-[#1B1B1E] break-all">
                {targetLabel}
              </p>
            )}
          </div>
        </div>

        <div className="p-5 text-[13px] text-[#5B403D] leading-relaxed whitespace-pre-line">
          {message}
        </div>

        <div className="px-5 py-3.5 bg-[#F6F2F7] border-t border-[#E4BEB9] flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="h-9 px-4 rounded-lg border border-[#E4BEB9] bg-white text-[13px] font-semibold text-[#1B1B1E] hover:bg-[#FBF8FC] cursor-pointer disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onConfirm}
            className={`h-9 px-4 rounded-lg text-[13px] font-semibold text-white cursor-pointer disabled:opacity-50 flex items-center gap-1.5 ${
              danger
                ? 'bg-[#93000B] hover:bg-[#7A0009]'
                : 'bg-[#111114] hover:bg-[#1B1B1E]'
            }`}
          >
            {loading ? 'Traitement...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
