export const applicationVersionLabel = metadata => `${metadata.name} v${metadata.version}`;

export function renderApplicationIdentity(targets, metadata) {
  const label = applicationVersionLabel(metadata);
  targets.forEach(target => {
    if (target) target.textContent = label;
  });
  return label;
}
