import { CsvImportWizard } from "../components/CsvImportWizard";

export function ImportAgentsPage() {
  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-8">
      <div className="w-full max-w-3xl">
        <h1 className="mb-4 text-heading-lg">Import agents</h1>
        <CsvImportWizard />
      </div>
    </div>
  );
}
export default ImportAgentsPage;
