"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserLicenseRepository = void 0;
const database_1 = require("../config/database");
const UserLicense_1 = require("../entities/UserLicense");
exports.UserLicenseRepository = database_1.AppDataSource.getRepository(UserLicense_1.UserLicense);
//# sourceMappingURL=UserLicenseRepository.js.map