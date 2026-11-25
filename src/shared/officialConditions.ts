import type { RentalConditionArticle } from '../db/schema.ts';

export const OFFICIAL_CONDITIONS_HEADER = {
  company: 'TRANS CAR',
  titleAr: 'الشروط العامة لعقد كراء السيارات',
  introAr: 'تُطبّق الشروط التالية على المستأجر طوال مدة الكراء، وفقًا للتشريع الجزائري المعمول به.',
  titleFr: 'Conditions Générales du Contrat de Location de Voitures',
  introFr:
    'Les conditions suivantes s’appliquent au locataire pendant toute la durée de la location, conformément à la législation algérienne en vigueur.',
  titleEn: 'General Terms and Conditions of Car Rental Agreement',
  introEn:
    'The following conditions apply to the renter throughout the rental period, in accordance with applicable Algerian legislation.',
};

export const OFFICIAL_CONDITIONS_V1: RentalConditionArticle[] = [
  {
    number: '01',
    titleAr: 'المادة 01 – مدة الكراء والتأخر:',
    bodyAr:
      'تُحدد مدة الكراء وموعد الإرجاع في الشروط الخاصة. تُمنح مهلة سماح قدرها 3 ساعات؛ إذا تجاوز التأخر 3 ساعات ولم يتجاوز 6 ساعات، يُحتسب نصف يوم إضافي، وإذا تجاوز 6 ساعات، يُحتسب يوم كراء كامل إضافي. كل تمديد يتطلب موافقة مسبقة من الوكالة والاتفاق على التكلفة.',
    titleFr: 'Article 01 – Durée de location et retard :',
    bodyFr:
      'La durée de location et la date de restitution sont fixées dans les conditions particulières. Une tolérance de 3 heures est accordée ; au-delà de 3 heures et jusqu’à 6 heures de retard, une demi-journée supplémentaire est facturée, et au-delà de 6 heures, une journée complète supplémentaire est facturée. Toute prolongation exige l’accord préalable de l’agence et la fixation du tarif.',
    titleEn: 'Article 01 – Rental Duration and Late Return:',
    bodyEn:
      'The rental duration and return time are specified in the special conditions. A 3-hour grace period is granted; if delay exceeds 3 hours up to 6 hours, an additional half-day is charged, and if it exceeds 6 hours, a full additional rental day is charged. Any extension requires prior agency approval and agreement on cost.',
  },
  {
    number: '02',
    titleAr: 'المادة 02 – المسافة:',
    bodyAr: 'المسافة المسموحة 350 كلم لكل 24 ساعة، وكل كيلومتر إضافي يُحتسب بـ50 دج.',
    titleFr: 'Article 02 – Kilométrage :',
    bodyFr:
      'La distance autorisée est de 350 km par tranche de 24 heures ; chaque kilomètre supplémentaire est facturé à 50 DZD.',
    titleEn: 'Article 02 – Mileage Allowance:',
    bodyEn:
      'The allowed distance is 350 km per 24 hours; each additional kilometer is charged at 50 DZD.',
  },
  {
    number: '03',
    titleAr: 'المادة 03 – شروط استعمال السيارة:',
    bodyAr:
      'يلتزم المستأجر بالمحافظة على السيارة واحترام قانون المرور. يُمنع منعًا باتًا تسليم السيارة أو تأجيرها للغير، أو السماح بقيادتها من شخص غير مصرّح به في العقد، أو استعمالها كسيارة أجرة أو للنقل بمقابل، بما في ذلك تطبيقات النقل وما شابهها. كما يُمنع منعًا باتًا إخراج السيارة من التراب الوطني الجزائري تحت أي ظرف، أو استعمالها في السباقات أو الأنشطة غير القانونية، أو السياقة المتهورة أو تحت تأثير الكحول أو المخدرات.',
    titleFr: 'Article 03 – Conditions d’utilisation du véhicule :',
    bodyFr:
      'Le locataire s’engage à préserver le véhicule et à respecter le code de la route. Il est strictement interdit de céder ou sous-louer le véhicule à un tiers, de le faire conduire par une personne non autorisée au contrat, ou de l’utiliser comme taxi ou pour le transport rémunéré, y compris via des applications VTC. Il est également strictement interdit de sortir le véhicule du territoire national algérien en toute circonstance, de l’utiliser pour des courses ou activités illégales, ou de conduire imprudemment ou sous l’emprise d’alcool ou de stupéfiants.',
    titleEn: 'Article 03 – Conditions of Vehicle Use:',
    bodyEn:
      'The renter agrees to take proper care of the vehicle and obey traffic laws. Handing over or subleasing the vehicle to third parties, allowing an unauthorized driver to operate it, or using it as a taxi or for paid passenger transport (including ride-hailing apps) is strictly prohibited. Taking the vehicle outside Algerian national territory under any circumstance, using it in races or illegal activities, or reckless driving or driving under the influence of alcohol or drugs is strictly prohibited.',
  },
  {
    number: '04',
    titleAr: 'المادة 04 – الأعطال:',
    bodyAr:
      'عند حدوث عطل خطير، يجب التوقف في مكان آمن وإبلاغ الوكالة فورًا، وعدم مواصلة السير إذا كان ذلك يفاقم الضرر أو يعرّض الأشخاص للخطر. لا يجوز إجراء إصلاحات على نفقة الوكالة دون موافقتها المسبقة، إلا لضرورة استعجالية مع إعلامها.',
    titleFr: 'Article 04 – Pannes mécaniques :',
    bodyFr:
      'En cas de panne grave, le locataire doit s’arrêter dans un endroit sûr et prévenir l’agence immédiatement, sans poursuivre la route si cela risque d’aggraver le dommage ou de mettre les personnes en danger. Aucune réparation ne peut être engagée aux frais de l’agence sans son accord préalable, sauf urgence avérée avec information immédiate.',
    titleEn: 'Article 04 – Mechanical Breakdowns:',
    bodyEn:
      'In the event of a serious breakdown, the renter must stop in a safe place and notify the agency immediately, and must not continue driving if doing so worsens damage or endangers people. Repairs may not be carried out at the agency’s expense without prior approval, except in urgent necessity with immediate notification.',
  },
  {
    number: '05',
    titleAr: 'المادة 05 – الحوادث والأضرار:',
    bodyAr:
      'يجب إبلاغ الوكالة فورًا عند وقوع حادث أو سرقة، واتخاذ الإجراءات القانونية اللازمة، والاتصال بالشرطة أو الدرك عند الاقتضاء. يلتزم المستأجر بتقديم وثائق الحادث ومعلوماته في أجل أقصاه 24 ساعة، مع مراعاة الآجال القانونية والتأمينية. وتشمل الوثائق، عند الاقتضاء، نسخة من البطاقة الرمادية للسيارة الأخرى، وشهادة تأمينها، ورخصة سياقة السائق الآخر، ورقم هاتفه أو رقم هاتف مالك السيارة، ومعلومات المعاينة الودية أو محضر الحادث. إذا وقع حادث غير متعمد ولم تثبت مسؤولية المستأجر عنه، تتحمل الوكالة تكاليف إصلاح سيارتها، مع مراعاة القانون وحقوقها تجاه المسؤول عن الحادث. أما الأضرار الناتجة عن خطأ المستأجر أو إهماله أو سوء استعماله أو مخالفته للعقد، فيتحمل تكاليفها المثبتة في حدود القانون. ويتحمل كذلك الأضرار الإضافية الناتجة عن عدم الإبلاغ أو تفاقم الضرر متى ثبتت مسؤوليته عنها.',
    titleFr: 'Article 05 – Accidents et dommages :',
    bodyFr:
      'En cas d’accident ou de vol, l’agence doit être avertie immédiatement et les démarches légales nécessaires doivent être accomplies auprès de la police ou de la gendarmerie si requis. Le locataire s’engage à fournir les documents et informations de l’accident dans un délai maximal de 24 heures, conformément aux délais légaux et d’assurance (copie de la carte grise et attestation d’assurance du tiers, permis et téléphone de l’autre conducteur ou propriétaire, constat amiable ou procès-verbal). En cas d’accident non intentionnel sans responsabilité établie du locataire, l’agence supporte la réparation de son véhicule sous réserve de ses droits envers le responsable. Les dommages résultant d’une faute, négligence, mauvaise utilisation ou violation du contrat par le locataire restent à sa charge prouvée dans les limites légales, ainsi que l’aggravation liée au défaut de déclaration.',
    titleEn: 'Article 05 – Accidents and Damages:',
    bodyEn:
      'The agency must be notified immediately upon an accident or theft, required legal steps must be taken, and police or gendarmerie contacted when applicable. The renter must submit accident documents and details within 24 hours at the latest, respecting legal and insurance deadlines (including copies of the other vehicle’s registration card, insurance certificate, other driver’s licence, contact number, and amicable report or police report). If an unintentional accident occurs where the renter is not at fault, the agency bears its vehicle’s repair costs subject to its legal rights against the liable party. Damages caused by the renter’s fault, negligence, misuse, or breach of contract are borne by the renter as substantiated within the law, along with additional damages from failure to report or aggravation.',
  },
  {
    number: '06',
    titleAr: 'المادة 06 – التجهيزات:',
    bodyAr:
      'يلتزم المستأجر بالمحافظة على جميع التجهيزات المذكورة في محضر التسليم الموجود في الجهة الثانية من العقد، بما فيها المفتاح، والعجلة الاحتياطية، والرافعة ومقبضها، والإطارات والجنوط وأغطية العجلات، ومطفأة الحريق، ومثلث التحذير، وسترة السلامة، والمقاعد وأغطيتها، والرف الخلفي والتجهيزات الداخلية. ويتحمل تكاليف الإصلاح أو الاستبدال الفعلية والمثبتة للتجهيزات المفقودة أو المتضررة بسبب يُنسب إليه، باستثناء الاستهلاك العادي.',
    titleFr: 'Article 06 – Équipements :',
    bodyFr:
      'Le locataire s’engage à préserver l’ensemble des équipements mentionnés dans l’état de remise au verso du contrat : clé, roue de secours, cric et manivelle, pneumatiques, jantes et enjoliveurs, extincteur, triangle de signalisation, gilet de sécurité, sièges et housses, plage arrière et équipements intérieurs. Il supporte les frais réels et justifiés de réparation ou de remplacement des équipements perdus ou endommagés de son fait, hors usure normale.',
    titleEn: 'Article 06 – Vehicle Equipment:',
    bodyEn:
      'The renter agrees to safeguard all equipment listed in the handover checklist on the reverse of the contract, including the key, spare wheel, jack and handle, tires, rims and hubcaps, fire extinguisher, warning triangle, safety vest, seats and covers, rear parcel shelf, and interior equipment. The renter bears actual substantiated repair or replacement costs for lost or damaged equipment attributable to them, excluding normal wear and tear.',
  },
  {
    number: '07',
    titleAr: 'المادة 07 – الوقود والنظافة:',
    bodyAr:
      'تُعاد السيارة بمستوى الوقود نفسه عند التسليم. يتحمل المستأجر تكلفة الوقود الناقص وتكاليف التنظيف الإضافية الفعلية والمثبتة عند الاتساخ الاستثنائي.',
    titleFr: 'Article 07 – Carburant et propreté :',
    bodyFr:
      'Le véhicule doit être restitué avec le même niveau de carburant qu’au départ. Le locataire supporte le coût du carburant manquant ainsi que les frais réels et justifiés de nettoyage exceptionnel en cas de salissure anormale.',
    titleEn: 'Article 07 – Fuel and Cleanliness:',
    bodyEn:
      'The vehicle must be returned with the same fuel level as at handover. The renter bears the cost of missing fuel and actual substantiated extra cleaning costs in case of exceptional dirtiness.',
  },
  {
    number: '08',
    titleAr: 'المادة 08 – المخالفات المرورية:',
    bodyAr:
      'يتحمل المستأجر مسؤولية جميع المخالفات المرورية والغرامات الناتجة عن استعمال السيارة خلال مدة الكراء، بما فيها المخالفات المسجلة بواسطة الرادارات، ويلتزم بالتعاون مع الوكالة لتحديد السائق المسؤول إذا وصلت المخالفات بعد انتهاء الكراء، وفقًا للقانون.',
    titleFr: 'Article 08 – Infractions routières :',
    bodyFr:
      'Le locataire est responsable de toutes les infractions au code de la route et amendes survenues durant la période de location, y compris celles relevées par radar, et s’engage à coopérer avec l’agence pour identifier le conducteur responsable si les avis parviennent après la restitution, conformément à la loi.',
    titleEn: 'Article 08 – Traffic Violations:',
    bodyEn:
      'The renter is responsible for all traffic violations and fines resulting from vehicle use during the rental period, including speed-camera fines, and agrees to cooperate with the agency to identify the responsible driver if notices arrive after the rental ends, in accordance with the law.',
  },
  {
    number: '09',
    titleAr: 'المادة 09 – الاستعمال غير القانوني:',
    bodyAr:
      'يُمنع منعًا باتًا استعمال السيارة في أي نشاط غير قانوني، أو نقل مواد أو بضائع ممنوعة، أو التهريب، أو ممارسة تجارة غير مرخصة، أو أي غرض مخالف للقانون أو لشروط العقد. ويتحمل المستأجر المسؤولية القانونية الكاملة أمام الجهات المختصة، كما يتحمل تكاليف جميع الأضرار والخسائر المثبتة التي تلحق بالوكالة نتيجة هذه المخالفات، وفقًا للقانون.',
    titleFr: 'Article 09 – Usage illégal :',
    bodyFr:
      'Il est strictement interdit d’utiliser le véhicule pour toute activité illégale, le transport de substances ou marchandises prohibées, la contrebande, le commerce non autorisé ou tout objet contraire à la loi ou au contrat. Le locataire assume l’entière responsabilité légale devant les autorités compétentes et supporte tous dommages et pertes prouvés subis par l’agence de ce fait, conformément à la loi.',
    titleEn: 'Article 09 – Illegal Use:',
    bodyEn:
      'Using the vehicle for any illegal activity, transporting prohibited materials or goods, smuggling, conducting unlicensed trade, or any purpose contrary to the law or contract terms is strictly prohibited. The renter assumes full legal liability before competent authorities and bears all substantiated damages and losses incurred by the agency as a result, in accordance with the law.',
  },
  {
    number: '10',
    titleAr: 'المادة 10 – تمديد العقد والإخلال بالشروط:',
    bodyAr:
      'يتطلب تمديد الكراء موافقة الوكالة مسبقًا والاتفاق على المدة والتكلفة. ويجب على المستأجر الحضور إلى الوكالة لإتمام التمديد، إلا في حالة بُعد المسافة أو وجود ظرف طارئ يمنع حضوره، حيث يُرسل العقد عبر واتساب أو البريد الإلكتروني، ويلتزم المستأجر بتأكيد استلامه بالرد بكلمة "استلمت" «REÇU». ويتحمّل المستأجر المسؤوليات والتكاليف المثبتة الناتجة عن إخلاله بشروط العقد، في حدود ما يسمح به القانون.',
    titleFr: 'Article 10 – Prolongation du contrat et manquement aux conditions :',
    bodyFr:
      'Toute prolongation de location requiert l’accord préalable de l’agence et la fixation de la durée et du coût. Le locataire doit se présenter à l’agence pour formaliser la prolongation, sauf éloignement ou urgence avérée empêchant son déplacement, auquel cas le contrat est transmis via WhatsApp ou e-mail et le locataire doit confirmer réception en répondant « استلمت » / « REÇU ». Le locataire supporte les responsabilités et coûts prouvés découlant du non-respect du contrat dans les limites prévues par la loi.',
    titleEn: 'Article 10 – Contract Extension and Breach of Terms:',
    bodyEn:
      'Rental extension requires prior agency approval and agreement on duration and cost. The renter must attend the agency in person to complete the extension, except in cases of long distance or emergency preventing attendance, where the contract is sent via WhatsApp or email and the renter must confirm receipt by replying "استلمت" / "REÇU". The renter bears substantiated liabilities and costs arising from breaching contract terms, within the limits permitted by law.',
  },
];
