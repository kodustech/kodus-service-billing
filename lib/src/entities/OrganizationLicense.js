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
exports.OrganizationLicense = exports.SubscriptionStatus = void 0;
const typeorm_1 = require("typeorm");
var SubscriptionStatus;
(function (SubscriptionStatus) {
    SubscriptionStatus["TRIAL"] = "trial";
    SubscriptionStatus["ACTIVE"] = "active";
    SubscriptionStatus["PAYMENT_FAILED"] = "payment_failed";
    SubscriptionStatus["CANCELED"] = "canceled";
    SubscriptionStatus["EXPIRED"] = "expired";
})(SubscriptionStatus || (exports.SubscriptionStatus = SubscriptionStatus = {}));
let OrganizationLicense = class OrganizationLicense {
    id;
    organizationId;
    subscriptionStatus;
    cloudToken;
    trialEnd;
    stripeCustomerId;
    stripeSubscriptionId;
    totalLicenses;
    assignedLicenses;
    createdAt;
    updatedAt;
};
exports.OrganizationLicense = OrganizationLicense;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)("uuid"),
    __metadata("design:type", String)
], OrganizationLicense.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], OrganizationLicense.prototype, "organizationId", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: "enum",
        enum: SubscriptionStatus,
        default: SubscriptionStatus.TRIAL,
    }),
    __metadata("design:type", String)
], OrganizationLicense.prototype, "subscriptionStatus", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], OrganizationLicense.prototype, "cloudToken", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: "timestamp" }),
    __metadata("design:type", Date)
], OrganizationLicense.prototype, "trialEnd", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true }),
    __metadata("design:type", String)
], OrganizationLicense.prototype, "stripeCustomerId", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true }),
    __metadata("design:type", String)
], OrganizationLicense.prototype, "stripeSubscriptionId", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: 0 }),
    __metadata("design:type", Number)
], OrganizationLicense.prototype, "totalLicenses", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: 0 }),
    __metadata("design:type", Number)
], OrganizationLicense.prototype, "assignedLicenses", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Date)
], OrganizationLicense.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)(),
    __metadata("design:type", Date)
], OrganizationLicense.prototype, "updatedAt", void 0);
exports.OrganizationLicense = OrganizationLicense = __decorate([
    (0, typeorm_1.Entity)("organization_licenses")
], OrganizationLicense);
//# sourceMappingURL=OrganizationLicense.js.map