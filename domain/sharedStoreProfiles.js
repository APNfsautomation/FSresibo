// Pure Company Directory identity and post-save decision rules shared by receipt workflows.
export const normalizeSharedStoreText = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
export const normalizeStoreTin = value => String(value || '').replace(/\D/g, '');
export const sharedProfileIdentity = profile => `${normalizeSharedStoreText(profile.storeName || profile.store)}\u0000${normalizeSharedStoreText(profile.address)}\u0000${normalizeStoreTin(profile.tin)}`;

export function findCompatibleSharedProfiles(candidate, profiles) {
  const store = normalizeSharedStoreText(candidate.storeName || candidate.store);
  const address = normalizeSharedStoreText(candidate.address);
  const tin = normalizeStoreTin(candidate.tin);
  return profiles.filter(profile => {
    const existingAddress = normalizeSharedStoreText(profile.address);
    const existingTin = normalizeStoreTin(profile.tin);
    return store && normalizeSharedStoreText(profile.storeName || profile.store) === store && (!address || !existingAddress || address === existingAddress) && (!tin || !existingTin || tin === existingTin);
  });
}

export function resolveSharedContributionCandidate(candidate, profiles) {
  const exact = profiles.find(profile => sharedProfileIdentity(profile) === sharedProfileIdentity(candidate));
  if (exact) return { status: 'existing', profile: exact };
  const compatible = findCompatibleSharedProfiles(candidate, profiles);
  if (compatible.length === 1) return { status: 'existing', profile: compatible[0] };
  if (compatible.length > 1) return { status: 'ambiguous', profiles: compatible };
  return { status: 'new' };
}

export const persistedStoreFingerprint = values => [
  normalizeSharedStoreText(values.storeName || values.store),
  normalizeSharedStoreText(values.address),
  normalizeStoreTin(values.tin)
].join('\u0000');

export const hasContributableStoreDetails = values => Boolean(
  String(values.storeName || values.store || '').trim() &&
  (String(values.address || '').trim() || String(values.tin || '').trim())
);

export function postSaveDirectoryDecision({ values, previousFingerprint, profiles }) {
  const candidate = { storeName: values.storeName || values.store, address: values.address, tin: values.tin, vat: values.vat };
  const fingerprint = persistedStoreFingerprint(candidate);
  if (!hasContributableStoreDetails(candidate)) return { status: 'ineligible', fingerprint };
  if (previousFingerprint === fingerprint) return { status: 'unchanged', fingerprint };
  return { ...resolveSharedContributionCandidate(candidate, profiles), fingerprint, candidate };
}

export function deduplicateDirectoryCandidates(candidates) {
  const seen = new Set();
  return candidates.filter(candidate => {
    const key = sharedProfileIdentity(candidate.candidate || candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const finalizeDirectoryPromptFingerprints = persisted => persisted.forEach(({ row, fingerprint }) => { row.dataset.persistedStoreFingerprint = fingerprint; });
