import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { OrganizationLicense } from "./OrganizationLicense";

export enum LicenseStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
}

export enum GitTool {
  GITHUB = "github",
  GITLAB = "gitlab",
  BITBUCKET = "bitbucket",
}

@Entity("user_licenses")
export class UserLicense {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  git_id: string;

  @Column({
    type: "enum",
    enum: LicenseStatus,
    default: LicenseStatus.ACTIVE,
  })
  licenseStatus: LicenseStatus;

  @Column({
    type: "enum",
    enum: GitTool,
  })
  git_tool: GitTool;

  @Column({ type: "timestamp" })
  assignedAt: Date;

  @Column()
  organizationLicenseId: string;

  @ManyToOne(() => OrganizationLicense)
  @JoinColumn({ name: "organizationLicenseId" })
  organizationLicense: OrganizationLicense;

  @CreateDateColumn()
  createdAt: Date;
}
