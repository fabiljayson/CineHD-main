/**
 * Offres et collecte manuelle (MTN MoMo / Orange Money).
 *
 * Il n'y a pas d'agrégateur : l'acheteur envoie lui-même l'argent sur un
 * numéro affiché, puis saisit la référence de sa transaction. L'admin
 * vérifie dans l'interface et valide. Les numéros de collecte viennent de
 * l'environnement — jamais codés en dur dans le dépôt.
 */

const PLANS = Object.freeze([
  Object.freeze({ id: 'week',  days: 7,   maxFcfa: 1500,  floorFcfa: 1300 }),
  Object.freeze({ id: 'month', days: 31,  maxFcfa: 5500,  floorFcfa: 3800 }),
  Object.freeze({ id: 'year',  days: 365, maxFcfa: 16000, floorFcfa: 13800 }),
]);

const PAYMENT_METHODS = Object.freeze([
  Object.freeze({ id: 'mtn_momo',     label: 'MTN MoMo',      envVar: 'PAYMENT_MTN_MOMO_NUMBER' }),
  Object.freeze({ id: 'orange_money', label: 'Orange Money',  envVar: 'PAYMENT_ORANGE_MONEY_NUMBER' }),
]);

function getPlanById(planId) {
  return PLANS.find((plan) => plan.id === planId) || null;
}

function getPaymentMethodById(methodId) {
  return PAYMENT_METHODS.find((method) => method.id === methodId) || null;
}

/** Baseline du curseur : la moitié du plancher, pour que la zone interdite existe. */
function sliderMinForPlan(plan) {
  return Math.max(1, Math.round(plan.floorFcfa / 2));
}

/** Numéros réellement renseignés en environnement (les autres sont masqués). */
function getConfiguredPaymentMethods() {
  return PAYMENT_METHODS
    .map((method) => ({ id: method.id, label: method.label, number: String(process.env[method.envVar] || '').trim() }))
    .filter((method) => method.number.length > 0);
}

function serializePlan(plan) {
  return {
    id: plan.id,
    days: plan.days,
    maxFcfa: plan.maxFcfa,
    floorFcfa: plan.floorFcfa,
    sliderMinFcfa: sliderMinForPlan(plan),
  };
}

function serializePlansPayload() {
  return {
    currency: 'XAF',
    plans: PLANS.map(serializePlan),
    methods: getConfiguredPaymentMethods(),
  };
}

/**
 * Contrôle serveur de la sélection. Retourne null si valide, sinon le message
 * d'erreur affiché tel quel au client.
 */
function validatePlanSelection(plan, amountFcfa, method) {
  if (!plan) return 'Offre invalide.';
  if (!method) return 'Moyen de paiement indisponible.';
  if (!Number.isInteger(amountFcfa)) return 'Montant invalide.';
  if (amountFcfa > plan.maxFcfa) return `Le montant ne peut pas dépasser ${plan.maxFcfa} FCFA.`;
  if (amountFcfa < plan.floorFcfa) {
    // Formulation volontaire du projet : plancher appliqué côté client ET serveur.
    return 'Gar tu derange nous on mange seulement les cailloux?';
  }
  return null;
}

module.exports = {
  PLANS,
  PAYMENT_METHODS,
  getPlanById,
  getPaymentMethodById,
  getConfiguredPaymentMethods,
  serializePlansPayload,
  validatePlanSelection,
};
