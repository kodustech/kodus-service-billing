"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrganizationLicenseRepository = void 0;
const database_1 = require("../config/database");
const OrganizationLicense_1 = require("../entities/OrganizationLicense");
exports.OrganizationLicenseRepository = database_1.AppDataSource.getRepository(OrganizationLicense_1.OrganizationLicense);
//# sourceMappingURL=OrganizationLicenseRepository.js.map