import { CompanyManager } from './src/server/services/companyManager';
async function run() {
  const companies = await CompanyManager.listCompanies();
  console.log(companies.map(c => c.legalName));
}
run();
