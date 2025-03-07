"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserLicense = exports.GitTool = exports.LicenseStatus = void 0;
const typeorm_1 = require("typeorm");
const OrganizationLicense_1 = require("./OrganizationLicense");
var LicenseStatus;
(function (LicenseStatus) {
    LicenseStatus["ACTIVE"] = "active";
    LicenseStatus["INACTIVE"] = "inactive";
})(LicenseStatus || (exports.LicenseStatus = LicenseStatus = {}));
var GitTool;
(function (GitTool) {
    GitTool["GITHUB"] = "github";
    GitTool["GITLAB"] = "gitlab";
    GitTool["BITBUCKET"] = "bitbucket";
})(GitTool || (exports.GitTool = GitTool = {}));
let UserLicense = class UserLicense {
    id;
    userId;
    git_id;
    licenseStatus;
    git_tool;
    assignedAt;
    organizationLicenseId;
    organizationLicense;
    createdAt;
};
exports.UserLicense = UserLicense;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)("uuid"),
    __metadata("design:type", String)
], UserLicense.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], UserLicense.prototype, "userId", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], UserLicense.prototype, "git_id", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: "enum",
        enum: LicenseStatus,
        default: LicenseStatus.ACTIVE,
    }),
    __metadata("design:type", String)
], UserLicense.prototype, "licenseStatus", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: "enum",
        enum: GitTool,
    }),
    __metadata("design:type", String)
], UserLicense.prototype, "git_tool", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: "timestamp" }),
    __metadata("design:type", Date)
], UserLicense.prototype, "assignedAt", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], UserLicense.prototype, "organizationLicenseId", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => OrganizationLicense_1.OrganizationLicense),
    (0, typeorm_1.JoinColumn)({ name: "organizationLicenseId" }),
    __metadata("design:type", OrganizationLicense_1.OrganizationLicense)
], UserLicense.prototype, "organizationLicense", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Date)
], UserLicense.prototype, "createdAt", void 0);
exports.UserLicense = UserLicense = __decorate([
    (0, typeorm_1.Entity)("user_licenses")
], UserLicense);
//# sourceMappingURL=UserLicense.js.map