import { AppDataSource } from "../config/database";
import { ConnectionLicense } from "../entities/ConnectionLicense";

export const ConnectionLicenseRepository =
  AppDataSource.getRepository(ConnectionLicense);
