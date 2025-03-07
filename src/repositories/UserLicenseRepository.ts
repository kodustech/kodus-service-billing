import { AppDataSource } from "../config/database";
import { UserLicense } from "../entities/UserLicense";

export const UserLicenseRepository = AppDataSource.getRepository(UserLicense); 