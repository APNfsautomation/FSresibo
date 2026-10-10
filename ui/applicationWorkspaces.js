// Composition adapters keep route metadata separate from each module's data model.
export function createApplicationWorkspaces({ receiptUi, monthlyFilingUi, quickOptimizerUi }) {
  let userId;
  const visibility = {
    receipts: visible => receiptUi.setModuleVisible(visible),
    'monthly-filing': visible => monthlyFilingUi.setVisible(visible),
    'quick-optimizer': visible => quickOptimizerUi.setModuleVisible(visible)
  };
  return {
    renderRoute(workspace, metadata) {
      Object.entries(visibility).forEach(([module, setVisible]) => setVisible(module === metadata.module));
      if (metadata.module === 'receipts') receiptUi.setWorkspace(workspace);
    },
    setUser(nextUserId) {
      if (nextUserId !== userId) quickOptimizerUi.clearForLogout();
      userId = nextUserId;
    },
    clearForLogout() {
      userId = undefined;
      quickOptimizerUi.clearForLogout();
      Object.values(visibility).forEach(setVisible => setVisible(false));
    }
  };
}
