export const applicationVersionLabel = metadata => `${metadata.name} v${metadata.version}`;

// Runtime identity comes from config/appMetadata.js: the browser title, application metadata and every [data-app-name] element.
export function renderApplicationName(documentRef, metadata) {
  documentRef.title = metadata.name;
  documentRef.querySelectorAll?.('[data-app-name]').forEach(target => { target.textContent = metadata.name; });
  documentRef.querySelectorAll?.('meta[name="application-name"], meta[name="apple-mobile-web-app-title"]').forEach(target => target.setAttribute('content', metadata.name));
  return metadata.name;
}

export function renderApplicationIdentity(targets, metadata) {
  const label = applicationVersionLabel(metadata);
  targets.forEach(target => {
    if (target) target.textContent = label;
  });
  return label;
}
