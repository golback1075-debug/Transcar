import React from 'react';
import type { ContractItem } from '../types.ts';
import { formatDate } from '../lib/api.ts';
import { buildContractAccessUrl, ContractQrCode } from './ContractQrCode.tsx';
import { VehicleInspectionDiagram } from './VehicleInspectionDiagram.tsx';

interface Props {
  contract: ContractItem;
  sheetLang?: 'ar' | 'fr';
}

function getFuelNeedleRotation(level: string): number {
  switch (level) {
    case '1/4':
      return -42;
    case '1/2':
      return 0;
    case '3/4':
      return 38;
    case '4/4':
    default:
      return 68;
  }
}

export const OfficialContractSheet: React.FC<Props> = ({ contract, sheetLang = 'ar' }) => {
  const isFr = sheetLang === 'fr';
  const cust = contract.customer;
  const drvCust = contract.driverCustomer;
  const veh = contract.vehicle;
  const startDate = new Date(contract.startAt);
  const endDate = new Date(contract.endAt);
  const startTime = Number.isNaN(startDate.getTime())
    ? '09:00'
    : startDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const endTime = Number.isNaN(endDate.getTime())
    ? '18:00'
    : endDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const needleAngle = getFuelNeedleRotation(contract.departureFuelLevel);
  const qrUrl = contract.digitalAccessToken
    ? buildContractAccessUrl(contract.digitalAccessToken)
    : '';

  const hasCustomDriver = Boolean(
    contract.driverCustomerId ||
      (contract.driverName && contract.driverName.trim() !== (cust?.fullName || '').trim()),
  );

  const renterDobDisplay =
    [cust?.dateOfBirth, cust?.birthPlace].filter(Boolean).join(' · ') || '—';

  const driverFullNameDisplay = hasCustomDriver
    ? contract.driverName || drvCust?.fullName || '—'
    : cust?.fullName || '—';
  const driverDobDisplay = hasCustomDriver
    ? contract.driverDob ||
      (drvCust ? [drvCust.dateOfBirth, drvCust.birthPlace].filter(Boolean).join(' · ') : '') ||
      '—'
    : renterDobDisplay;
  const driverIdDisplay = hasCustomDriver
    ? contract.driverIdNumber || drvCust?.idNumber || '—'
    : cust?.idNumber || '—';
  const driverLicenceDisplay = hasCustomDriver
    ? contract.driverLicenceNumber || drvCust?.licenceNumber || '—'
    : cust?.licenceNumber || '—';
  const driverCountryDisplay = hasCustomDriver
    ? contract.driverCountry || drvCust?.country || (isFr ? 'Algérie' : 'الجزائر')
    : cust?.country || (isFr ? 'Algérie' : 'الجزائر');
  const driverAddressDisplay = hasCustomDriver
    ? contract.driverAddress || drvCust?.address || '—'
    : cust?.address || '—';
  const driverPhoneDisplay = hasCustomDriver
    ? contract.driverPhone || drvCust?.phone || '—'
    : cust?.phone || '—';

  const maxMileageDisplay =
    contract.maxMileageLimit !== null &&
    contract.maxMileageLimit !== undefined &&
    Number.isFinite(Number(contract.maxMileageLimit))
      ? Number(contract.maxMileageLimit).toLocaleString('fr-FR')
      : '__________';

  const blankLine = '__________';
  const earlyReturnDateDisplay = contract.earlyReturnDate?.trim() || blankLine;
  const earlyReturnTimeDisplay = contract.earlyReturnTime?.trim() || blankLine;
  const earlyReturnLocationDisplay = contract.earlyReturnLocation?.trim() || blankLine;

  const extensionFromDateDisplay = contract.extensionFromDate?.trim() || blankLine;
  const extensionUntilDateDisplay = contract.extensionUntilDate?.trim() || blankLine;
  const extensionExitTimeDisplay = contract.extensionExitTime?.trim() || blankLine;
  const extensionEntryTimeDisplay = contract.extensionEntryTime?.trim() || blankLine;

  return (
    <div
      dir={isFr ? 'ltr' : 'rtl'}
      className="print-only-sheet print-contract-sheet bg-white text-[#111827] border border-[#cbd5e1] rounded-lg overflow-hidden shadow-sm font-[Cairo,sans-serif] text-[12px] leading-snug"
    >
      {/* Official Top Header Matching Owner Contract */}
      <div className="contract-top-header px-5 pt-4 pb-3 flex items-start justify-between gap-4 border-b-2 border-[#dc2626]">
        {/* Agency contact details */}
        <div className="contract-agency-lines flex flex-col gap-1 text-[11px] font-semibold text-[#111827]">
          <div className="flex items-center gap-2">
            <span className="w-4 h-4 rounded-full bg-[#dc2626] text-white inline-flex items-center justify-center text-[10px]">
              📍
            </span>
            <span>{isFr ? 'Larbi Tébessi 09000 Blida, Algérie' : 'العربي تيسي 09000 البليدة الجزائر'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-4 h-4 rounded-full bg-[#dc2626] text-white inline-flex items-center justify-center text-[10px]">
              📄
            </span>
            <span dir="ltr" className="font-mono">
              {isFr ? 'Registre de commerce : 4038527A04' : 'رقم التسجيل التجاري : 4038527A04'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-4 h-4 rounded-full bg-[#dc2626] text-white inline-flex items-center justify-center text-[10px]">
              📞
            </span>
            <span dir="ltr" className="font-mono font-bold">
              0560 97 05 36
            </span>
          </div>
          <div className="flex items-center gap-2.5 text-[10px]">
            <a
              href="https://wa.me/213560970536"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[#15803D] hover:underline font-mono"
            >
              <span>💬 WhatsApp: 0560 97 05 36</span>
            </a>
            <a
              href="viber://chat?number=%2B213560970536"
              className="inline-flex items-center gap-1 text-[#7C3AED] hover:underline font-mono"
            >
              <span>🟣 Viber: 0560 97 05 36</span>
            </a>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-4 h-4 rounded-full bg-[#dc2626] text-white inline-flex items-center justify-center text-[10px]">
              ✉
            </span>
            <span dir="ltr" className="font-mono">
              trans.car@hotmail.fr
            </span>
          </div>
        </div>

        {/* Official TransCar Logo */}
        <div className={`flex flex-col justify-center shrink-0 ${isFr ? 'items-end text-right' : 'items-end text-left'}`}>
          <div className="flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 rounded-full bg-[#dc2626] inline-block" />
            <span className="contract-logo-brand text-[28px] font-black tracking-tight text-[#dc2626] leading-none">
              TransCar
            </span>
          </div>
          <span className="contract-logo-sub text-[15px] font-bold text-[#dc2626] mt-0.5">
            {isFr ? 'Location de Voitures' : 'تأجير السيارات'}
          </span>
        </div>
      </div>

      {/* Title Banner + QR Access + Contract Number */}
      <div className="contract-title-bar px-5 py-2.5 flex items-center justify-between gap-3 bg-[#f8fafc] border-b border-[#e2e8f0]">
        <div className="contract-title-badge bg-[#dc2626] text-white px-6 py-1.5 rounded-md font-bold text-[18px] tracking-wide">
          {isFr ? 'Contrat de Location de Voiture' : 'عقد تأجير السيارة'}
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          {qrUrl && (
            <div className="contract-qr-badge flex items-center gap-1.5 bg-white border border-[#cbd5e1] rounded p-1 shrink-0">
              <ContractQrCode
                value={qrUrl}
                size={40}
                quietMargin={1}
                className="contract-qr-svg shrink-0"
                label={isFr ? 'QR Code accès contrat' : 'رمز QR للعقد الرقمي'}
              />
              <span className="contract-qr-caption text-[9px] leading-tight font-semibold text-[#475569] max-w-[54px]">
                {isFr ? 'Accès digital' : 'عقد رقمي'}
              </span>
            </div>
          )}
          <div className="contract-number-box border border-[#94a3b8] bg-[#e2e8f0]/60 rounded-lg px-4 py-1.5 flex items-center gap-2 shrink-0">
            <span className="font-bold text-[#1e293b]">
              {isFr ? 'N° Contrat :' : 'رقم العقد :'}
            </span>
            <span dir="ltr" className="font-mono font-bold text-[#93000B] text-[13px]">
              {contract.contractNumber}
            </span>
          </div>
        </div>
      </div>

      {/* Two-Column Body Matching Official Scan */}
      <div className="contract-columns p-4 grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-3.5">
        {/* Column 1: Renter, Driver 1, Vehicle, Odometer + Mileage Red Warning */}
        <div className="contract-col-stack flex flex-col gap-3 min-w-0">
          {/* Locataire / المستأجر */}
          <div className="contract-card border border-[#cbd5e1] rounded-lg overflow-hidden">
            <div className="contract-card-header bg-[#1e293b] text-white px-3 py-1.5 flex items-center gap-2 font-bold text-[13px]">
              <span className="w-5 h-5 rounded-full bg-[#dc2626] inline-flex items-center justify-center text-[11px]">
                👤
              </span>
              <span>{isFr ? 'Locataire :' : 'المستأجر :'}</span>
            </div>
            <div className="contract-card-body p-2.5 flex flex-col gap-1.5 bg-white">
              <div className="contract-row flex justify-between gap-2 border-b border-[#e2e8f0] pb-1">
                <span className="text-[#475569] font-semibold shrink-0">
                  {isFr ? 'Nom et prénom :' : 'الاسم واللقب:'}
                </span>
                <span className="font-bold text-[#111827] text-end break-words min-w-0">{cust?.fullName || '—'}</span>
              </div>
              <div className="contract-row flex justify-between gap-2 border-b border-[#e2e8f0] pb-1">
                <span className="text-[#475569] font-semibold shrink-0">
                  {isFr ? 'Date et lieu de naissance :' : 'تاريخ ومكان الميلاد:'}
                </span>
                <span className="font-semibold text-end break-words min-w-0">{renterDobDisplay}</span>
              </div>
              <div className="contract-row flex justify-between gap-2 border-b border-[#e2e8f0] pb-1">
                <span className="text-[#475569] font-semibold shrink-0">
                  {isFr ? 'Adresse :' : 'العنوان:'}
                </span>
                <span className="font-semibold text-end break-words min-w-0">{cust?.address || '—'}</span>
              </div>
              <div className="contract-row flex justify-between gap-2 border-b border-[#e2e8f0] pb-1">
                <span className="text-[#475569] font-semibold shrink-0">
                  {isFr ? 'CNI / Passeport N° :' : 'بطاقة التعريف/جواز السفر رقم:'}
                </span>
                <span dir="ltr" className="font-mono font-bold text-end break-all min-w-0">
                  {cust?.idNumber || '—'}
                </span>
              </div>
              <div className="contract-row flex justify-between gap-2 border-b border-[#e2e8f0] pb-1">
                <span className="text-[#475569] font-semibold shrink-0">
                  {isFr ? 'Permis de conduire / Délivré par :' : 'رخصة السياقة / صادرة عن:'}
                </span>
                <span dir="ltr" className="font-mono font-semibold text-end break-words min-w-0">
                  {cust?.licenceNumber || '—'} {cust?.idIssuedBy ? `· ${cust.idIssuedBy}` : ''}
                </span>
              </div>
              <div className="contract-row flex justify-between gap-2 pt-1">
                <span className="text-[#475569] font-semibold shrink-0">
                  {isFr ? 'Téléphone / Signature :' : 'الهاتف / إمضاء المستأجر:'}
                </span>
                <span dir="ltr" className="font-mono font-semibold text-end break-all min-w-0">
                  {cust?.phone || '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Conducteur 1 / السائق 1 */}
          <div className="contract-card border border-[#cbd5e1] rounded-lg overflow-hidden">
            <div className="contract-card-header bg-[#1e293b] text-white px-3 py-1.5 flex items-center gap-2 font-bold text-[13px]">
              <span className="w-5 h-5 rounded-full bg-[#dc2626] inline-flex items-center justify-center text-[11px]">
                👤
              </span>
              <span>{isFr ? 'Conducteur 1 :' : 'السائق 1 :'}</span>
            </div>
            <div className="contract-card-body p-2.5 flex flex-col gap-1.5 bg-white">
              <div className="contract-row flex justify-between gap-2 border-b border-[#e2e8f0] pb-1">
                <span className="text-[#475569] font-semibold shrink-0">
                  {isFr ? 'Nom et prénom :' : 'الاسم واللقب:'}
                </span>
                <span className="font-semibold text-end break-words min-w-0">{driverFullNameDisplay}</span>
              </div>
              <div className="contract-row flex justify-between gap-2 border-b border-[#e2e8f0] pb-1">
                <span className="text-[#475569] font-semibold shrink-0">
                  {isFr ? 'Date et lieu de naissance :' : 'تاريخ ومكان الميلاد:'}
                </span>
                <span className="text-end break-words min-w-0">{driverDobDisplay}</span>
              </div>
              <div className="contract-row flex justify-between gap-2 border-b border-[#e2e8f0] pb-1">
                <span className="text-[#475569] font-semibold shrink-0">
                  {isFr ? "N° Pièce d'identité :" : 'رقم بطاقة التعريف:'}
                </span>
                <span dir="ltr" className="font-mono text-end break-all min-w-0">
                  {driverIdDisplay}
                </span>
              </div>
              <div className="contract-row flex justify-between gap-2 border-b border-[#e2e8f0] pb-1">
                <span className="text-[#475569] font-semibold shrink-0">
                  {isFr ? 'N° Permis de conduire :' : 'رقم رخصة السياقة:'}
                </span>
                <span dir="ltr" className="font-mono text-end break-all min-w-0">
                  {driverLicenceDisplay}
                </span>
              </div>
              <div className="contract-row flex justify-between gap-2 border-b border-[#e2e8f0] pb-1">
                <span className="text-[#475569] font-semibold shrink-0">
                  {isFr ? 'Pays :' : 'البلد:'}
                </span>
                <span className="text-end break-words min-w-0">{driverCountryDisplay}</span>
              </div>
              <div className="contract-row flex justify-between gap-2 border-b border-[#e2e8f0] pb-1">
                <span className="text-[#475569] font-semibold shrink-0">
                  {isFr ? 'Adresse permanente :' : 'العنوان الدائم:'}
                </span>
                <span className="text-end break-words min-w-0">{driverAddressDisplay}</span>
              </div>
              <div className="contract-row flex justify-between gap-2">
                <span className="text-[#475569] font-semibold shrink-0">
                  {isFr ? 'Téléphone :' : 'الهاتف:'}
                </span>
                <span dir="ltr" className="font-mono text-end break-all min-w-0">
                  {driverPhoneDisplay}
                </span>
              </div>
            </div>
          </div>

          {/* Véhicule / المركبة */}
          <div className="contract-card border border-[#cbd5e1] rounded-lg overflow-hidden">
            <div className="contract-card-header bg-[#1e293b] text-white px-3 py-1.5 flex items-center gap-2 font-bold text-[13px]">
              <span className="w-5 h-5 rounded-full bg-[#dc2626] inline-flex items-center justify-center text-[11px]">
                🚗
              </span>
              <span>{isFr ? 'Véhicule :' : 'المركبة :'}</span>
            </div>
            <div className="contract-card-body p-2.5 flex flex-col gap-1.5 bg-white">
              <div className="contract-row flex justify-between gap-2 border-b border-[#e2e8f0] pb-1">
                <span className="text-[#475569] font-semibold shrink-0">
                  {isFr ? 'Voiture et matricule :' : 'السيارة والترقيم:'}
                </span>
                <span className="font-bold text-end break-words min-w-0">
                  {veh ? `${veh.brand} ${veh.model} (${veh.year})` : '—'} ·{' '}
                  <span dir="ltr" className="font-mono text-[#93000B]">
                    {veh?.registrationNumber || '—'}
                  </span>
                </span>
              </div>
              <div className="contract-row flex justify-between gap-2 border-b border-[#e2e8f0] pb-1">
                <span className="text-[#475569] font-semibold shrink-0">
                  {isFr ? 'Couleur :' : 'اللون:'}
                </span>
                <span className="font-semibold text-end break-words min-w-0">{veh?.color || '—'}</span>
              </div>
              <div className="contract-row flex justify-between gap-2 border-b border-[#e2e8f0] pb-1">
                <span className="text-[#475569] font-semibold shrink-0">
                  {isFr ? 'Série moteur :' : 'سلسلة المحرك:'}
                </span>
                <span dir="ltr" className="font-mono text-end break-all min-w-0">
                  {veh?.engineSeries || '—'}
                </span>
              </div>
              <div className="contract-row flex justify-between gap-2 border-b border-[#e2e8f0] pb-1">
                <span className="text-[#475569] font-semibold shrink-0">
                  {isFr ? 'N° de châssis :' : 'رقم الهيكل:'}
                </span>
                <span dir="ltr" className="font-mono text-end break-all min-w-0">
                  {veh?.chassisNumber || '—'}
                </span>
              </div>
              <div className="contract-row flex justify-between gap-2">
                <span className="text-[#475569] font-semibold shrink-0">
                  {isFr ? 'Énergie :' : 'نوع الطاقة:'}
                </span>
                <span className="font-semibold text-end break-words min-w-0">{veh?.fuelType || '—'}</span>
              </div>
            </div>
          </div>

          {/* Compteur kilométrique / عداد الكيلومترات + RED Mileage Warning */}
          <div className="contract-card border border-[#cbd5e1] rounded-lg overflow-hidden">
            <div className="contract-card-header bg-[#1e293b] text-white px-3 py-1.5 flex items-center gap-2 font-bold text-[13px]">
              <span className="w-5 h-5 rounded-full bg-[#dc2626] inline-flex items-center justify-center text-[11px]">
                ⏱
              </span>
              <span>{isFr ? 'Compteur kilométrique :' : 'عداد الكيلومترات :'}</span>
            </div>
            <div className="contract-card-body p-2.5 flex flex-col gap-1.5 bg-white">
              <div className="contract-row flex justify-between gap-2 border-b border-[#e2e8f0] pb-1">
                <span className="text-[#475569] font-semibold shrink-0">
                  {isFr ? 'Km de départ :' : 'كيلومترات الانطلاق:'}
                </span>
                <span dir="ltr" className="font-mono font-bold">
                  {contract.departureMileage.toLocaleString('fr-FR')} km
                </span>
              </div>
              <div className="contract-row flex justify-between gap-2 border-b border-[#e2e8f0] pb-1">
                <span className="text-[#475569] font-semibold shrink-0">
                  {isFr ? 'Km de retour :' : 'كيلومترات الوصول:'}
                </span>
                <span dir="ltr" className="font-mono font-bold">
                  {contract.returnRecord
                    ? `${contract.returnRecord.returnMileage.toLocaleString('fr-FR')} km`
                    : '....................'}
                </span>
              </div>
              <div
                className="contract-mileage-warning rounded border border-[#dc2626]/60 bg-[#FEF2F2] px-2 py-1 text-center font-extrabold text-[#dc2626] tracking-wide"
                style={{ color: '#dc2626' }}
              >
                {isFr
                  ? `ATTENTION : NE PAS DÉPASSER LE KILOMÉTRAGE SUIVANT : ${maxMileageDisplay} KM`
                  : `تنبيه : يرجى عدم تجاوز المسافة التالية : ${maxMileageDisplay} كلم`}
              </div>
            </div>
          </div>
        </div>

        {/* Column 2: Dates, Early Return, Extension & Diagram, Fuel + Signatures */}
        <div className="contract-col-stack flex flex-col gap-3 min-w-0">
          {/* 1. Durée / مدة الكراء */}
          <div className="contract-card border border-[#cbd5e1] rounded-lg overflow-hidden">
            <div className="contract-card-header bg-[#1e293b] text-white px-3 py-1.5 flex items-center gap-2 font-bold text-[13px]">
              <span className="w-5 h-5 rounded-full bg-[#dc2626] inline-flex items-center justify-center text-[11px]">
                📅
              </span>
              <span>
                {isFr ? 'Durée de location / Départ et retour :' : 'مدة الكراء / الوصول والمغادرة :'}
              </span>
            </div>
            <div className="contract-card-body p-2.5 flex flex-col gap-1.5 bg-white">
              <div className="contract-row flex justify-between gap-2 border-b border-[#e2e8f0] pb-1">
                <span className="text-[#475569] font-semibold shrink-0">
                  {isFr ? 'Date de départ :' : 'تاريخ البداية:'}
                </span>
                <span dir="ltr" className="font-mono font-bold text-end">
                  {formatDate(contract.startAt)} · {startTime}
                </span>
              </div>
              <div className="contract-row flex justify-between gap-2 border-b border-[#e2e8f0] pb-1">
                <span className="text-[#475569] font-semibold shrink-0">
                  {isFr ? 'Date de retour :' : 'تاريخ النهاية:'}
                </span>
                <span dir="ltr" className="font-mono font-bold text-end">
                  {formatDate(contract.endAt)} · {endTime}
                </span>
              </div>
              <div className="contract-row flex justify-between gap-2 border-b border-[#e2e8f0] pb-1">
                <span className="text-[#475569] font-semibold shrink-0">
                  {isFr ? 'Nombre de jours :' : 'عدد الأيام:'}
                </span>
                <span className="font-bold">
                  {contract.durationDays} {isFr ? 'jours' : 'يوما'}
                </span>
              </div>
              <div className="contract-row flex justify-between gap-2 border-b border-[#e2e8f0] pb-1">
                <span className="text-[#475569] font-semibold shrink-0">
                  {isFr ? 'Lieu de livraison :' : 'مكان التسليم:'}
                </span>
                <span className="text-end break-words min-w-0">
                  {contract.pickupLocation || (isFr ? 'Blida' : 'البليدة')}
                </span>
              </div>
              <div className="contract-row flex justify-between gap-2">
                <span className="text-[#475569] font-semibold shrink-0">
                  {isFr ? 'Lieu de restitution :' : 'مكان الاسترجاع:'}
                </span>
                <span className="text-end break-words min-w-0">
                  {contract.returnLocation || (isFr ? 'Blida' : 'البليدة')}
                </span>
              </div>
            </div>
          </div>

          {/* 2. Retour anticipé du véhicule / الإرجاع المبكر للمركبة */}
          <div className="contract-card border border-[#cbd5e1] rounded-lg overflow-hidden">
            <div className="contract-card-header bg-[#1e293b] text-white px-3 py-1.5 flex items-center gap-2 font-bold text-[13px]">
              <span className="w-5 h-5 rounded-full bg-[#dc2626] inline-flex items-center justify-center text-[11px]">
                ↩
              </span>
              <span>
                {isFr ? 'Retour anticipé du véhicule :' : 'الإرجاع المبكر للمركبة :'}
              </span>
            </div>
            <div className="contract-card-body p-2.5 bg-white flex flex-col gap-1.5">
              <div className="grid grid-cols-2 gap-2 border-b border-[#e2e8f0] pb-1">
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-[#475569] font-semibold shrink-0">
                    {isFr ? 'Date de retour :' : 'تاريخ الإرجاع :'}
                  </span>
                  <span dir="ltr" className="font-mono font-bold text-end">
                    {earlyReturnDateDisplay}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-[#475569] font-semibold shrink-0">
                    {isFr ? 'Heure de retour :' : 'ساعة الإرجاع :'}
                  </span>
                  <span dir="ltr" className="font-mono font-bold text-end">
                    {earlyReturnTimeDisplay}
                  </span>
                </div>
              </div>
              <div className="contract-row flex justify-between gap-2">
                <span className="text-[#475569] font-semibold shrink-0">
                  {isFr ? 'Lieu de restitution :' : 'مكان الإرجاع :'}
                </span>
                <span className="font-semibold text-end break-words min-w-0">
                  {earlyReturnLocationDisplay}
                </span>
              </div>
            </div>
          </div>

          {/* 3. Prolongation & état du véhicule / التمديد وفحص الهيكل */}
          <div className="contract-card border border-[#cbd5e1] rounded-lg overflow-hidden">
            <div className="contract-card-header bg-[#1e293b] text-white px-3 py-1.5 flex items-center gap-2 font-bold text-[13px]">
              <span className="w-5 h-5 rounded-full bg-[#dc2626] inline-flex items-center justify-center text-[11px]">
                🚘
              </span>
              <span>
                {isFr ? 'Prolongation et état du véhicule :' : 'التمديد وفحص الهيكل :'}
              </span>
            </div>
            <div className="contract-card-body p-2.5 bg-white flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] border-b border-[#e2e8f0] pb-2">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[#475569] font-semibold shrink-0">
                    {isFr ? 'Prolongation du jour :' : 'تمديد من يوم :'}
                  </span>
                  <span dir="ltr" className="font-mono font-semibold text-end">
                    {extensionFromDateDisplay}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[#475569] font-semibold shrink-0">
                    {isFr ? "Jusqu'au :" : 'إلى غاية :'}
                  </span>
                  <span dir="ltr" className="font-mono font-semibold text-end">
                    {extensionUntilDateDisplay}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[#475569] font-semibold shrink-0">
                    {isFr ? 'Heure de sortie :' : 'ساعة الخروج :'}
                  </span>
                  <span dir="ltr" className="font-mono font-semibold text-end">
                    {extensionExitTimeDisplay}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[#475569] font-semibold shrink-0">
                    {isFr ? "Heure d'entrée :" : 'ساعة الدخول :'}
                  </span>
                  <span dir="ltr" className="font-mono font-semibold text-end">
                    {extensionEntryTimeDisplay}
                  </span>
                </div>
              </div>

              {/* 62-Zone Vehicle Inspection Diagram (Departure & Return) */}
              <div className="flex flex-col gap-2 py-1">
                {(() => {
                  const parseMarks = (raw: unknown[] | undefined) => {
                    if (!Array.isArray(raw)) return [];
                    return raw.map((item) => {
                      if (item && typeof item === 'object') return item as any;
                      const num = Number(item);
                      return { zoneNumber: Number.isFinite(num) ? num : 1, damageType: 'scratch' as const };
                    });
                  };
                  return (
                    <>
                      <VehicleInspectionDiagram
                        selectedZones={parseMarks(contract.departureDamageJson)}
                        readOnly={true}
                        lang={sheetLang}
                        title={isFr ? 'État au départ (62 zones)' : 'حالة الانطلاق (62 منطقة)'}
                      />
                      {contract.returnRecord && (
                        <VehicleInspectionDiagram
                          selectedZones={parseMarks(contract.returnRecord.damageMarkersJson)}
                          readOnly={true}
                          lang={sheetLang}
                          title={isFr ? 'État au retour (62 zones)' : 'حالة الإرجاع (62 منطقة)'}
                        />
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          </div>

          {/* 4 & 5. Fuel Level + Signatures grouped with fixed 2.5mm gap (2–3 mm) */}
          <div className="contract-fuel-sig-group flex flex-col gap-[2.5mm]">
            {/* Full-width compact Niveau carburant (Pricing Box Removed) */}
            <div className="contract-card border border-[#cbd5e1] rounded-lg overflow-hidden">
              <div className="contract-card-header bg-[#1e293b] text-white px-3 py-1 flex items-center justify-between gap-2 font-bold text-[12px]">
                <span className="flex items-center gap-1.5">
                  <span>⛽</span>
                  <span>{isFr ? 'Niveau carburant :' : 'مستوى البنزين :'}</span>
                </span>
                <span dir="ltr" className="font-mono text-[11px] font-bold">
                  {contract.departureFuelLevel}
                </span>
              </div>
              <div className="contract-card-body p-2 bg-white flex items-center justify-center gap-4">
                <svg viewBox="0 0 120 64" className="contract-fuel-svg w-24 h-12 shrink-0">
                  <path
                    d="M 15 55 A 45 45 0 0 1 105 55"
                    fill="none"
                    stroke="#e2e8f0"
                    strokeWidth="10"
                    strokeLinecap="round"
                  />
                  <path
                    d="M 15 55 A 45 45 0 0 1 42 18"
                    fill="none"
                    stroke="#dc2626"
                    strokeWidth="10"
                    strokeLinecap="round"
                  />
                  <g transform={`translate(60,55) rotate(${needleAngle})`}>
                    <line x1="0" y1="0" x2="0" y2="-36" stroke="#111827" strokeWidth="2.5" />
                    <circle cx="0" cy="0" r="4" fill="#dc2626" />
                  </g>
                  <text x="8" y="62" fontSize="11" fontWeight="bold" fill="#111827">
                    E
                  </text>
                  <text x="105" y="62" fontSize="11" fontWeight="bold" fill="#111827">
                    F
                  </text>
                </svg>
                <div className="flex items-center gap-2 text-[11px] font-semibold text-[#475569]">
                  {(['1/4', '1/2', '3/4', '4/4'] as const).map((lvl) => (
                    <span
                      key={lvl}
                      dir="ltr"
                      className={`font-mono px-2 py-0.5 rounded border ${
                        contract.departureFuelLevel === lvl
                          ? 'bg-[#dc2626] text-white border-[#dc2626] font-bold'
                          : 'bg-[#f8fafc] text-[#475569] border-[#cbd5e1]'
                      }`}
                    >
                      {lvl}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Signatures & Official Stamp Box — 2.5mm directly below Fuel Level */}
            <div className="contract-card contract-sig-box border border-[#cbd5e1] rounded-lg p-2.5 bg-[#f8fafc] grid grid-cols-2 gap-3 text-[11px]">
              <div className="flex flex-col">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#475569] font-semibold">
                    {isFr ? 'Remis le :' : 'تم التسليم بتاريخ:'}
                  </span>
                  <span dir="ltr" className="font-mono font-bold">
                    {formatDate(contract.startAt)}
                  </span>
                </div>
                <div
                  className="contract-sig-date-space h-7"
                  aria-label={isFr ? 'Espace signature remise' : 'مساحة التوقيع أسفل تاريخ التسليم'}
                />
                <span className="text-[#475569] font-semibold block mb-1">
                  {isFr ? 'Signature du locataire (Lu et approuvé) :' : 'إمضاء المستأجر (قرئ ووافق):'}
                </span>
                <div
                  className="contract-sig-space h-20"
                  aria-label={isFr ? 'Espace signature locataire' : 'مساحة إمضاء المستأجر'}
                />
              </div>
              <div className="flex flex-col">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[#15803D] font-bold">
                    {isFr ? 'Remis avec succès' : 'تم التسليم بنجاح'}
                  </span>
                </div>
                <span className="text-[#475569] font-semibold block mb-1">
                  {isFr ? 'Signature et cachet du loueur (TRANSCAR) :' : 'إمضاء وختم المؤجر (TRANSCAR):'}
                </span>
                <div
                  className="contract-sig-space contract-sig-agency-space flex-1 min-h-24"
                  aria-label={isFr ? 'Espace signature et cachet agence' : 'مساحة إمضاء وختم المؤجر'}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Official Red Banner */}
      <div className="contract-bottom-banner bg-[#dc2626] text-white text-center py-2 font-bold text-[15px] tracking-wide">
        {isFr ? 'TRANSCAR .. Toujours à votre service' : 'ترانس كار .. دائماً في خدمتكـم'}
      </div>
    </div>
  );
};

