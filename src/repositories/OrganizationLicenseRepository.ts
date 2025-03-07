import { AppDataSource } from "../config/database";
import { OrganizationLicense } from "../entities/OrganizationLicense";

export const OrganizationLicenseRepository = AppDataSource.getRepository(OrganizationLicense); 