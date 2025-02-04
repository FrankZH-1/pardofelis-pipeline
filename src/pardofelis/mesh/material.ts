// material related classes
// by chengtian.he
// 2023.3.22

import { vec3 } from "gl-matrix";

import type { IGPUObject } from "../gpu_object";
import type { UniformBindGroup } from "../uniform/bind_group";
import type { UniformPropertyStruct } from "../uniform/property/struct";
import type { IInspectorDrawable } from "../editor/inspector";
import { ImGui } from "@zhobo63/imgui-ts";

export class MaterialRegistry {
  private static readonly materials: { [key: string]: Material } = {};

  static add(mat: Material) {
    console.log("[MaterialRegistry] add material", mat.name, mat);
    if (mat.name in MaterialRegistry.materials) {
      console.warn("[MaterialRegistry]", mat.name, "already registered, ignoring", mat, MaterialRegistry.materials[mat.name]);
      return;
    }
    MaterialRegistry.materials[mat.name] = mat;
  }

  static get(name: string) {
    const mat = MaterialRegistry.materials[name];
    return mat == undefined ? null : mat;
  }

  static getAll() {
    return Object.entries(this.materials).map(p => p[1]);
  }
}

export class MaterialTexture implements IGPUObject {
  filePath: string;
  data: ImageBitmap = null;
  format: GPUTextureFormat;
  gpuTexture: GPUTexture = null;
  gpuTextureView: GPUTextureView = null;

  constructor(format: GPUTextureFormat) {
    this.format = format;
  }

  isValid() {
    return this.data != null;
  }

  createGPUObjects(device: GPUDevice) {
    if (!this.isValid()) return;
    this.gpuTexture = device.createTexture({
      size: [this.data.width, this.data.height, 1],
      format: this.format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.gpuTextureView = this.gpuTexture.createView();
    device.queue.copyExternalImageToTexture(
      { source: this.data },
      { texture: this.gpuTexture },
      [this.data.width, this.data.height]
    );
  }

  clearGPUObjects() {
    this.gpuTexture = null;
    this.gpuTextureView = null;
  }
}

// we use PBR rough/metal for Pardofelis's base material
// which includes albedo, emission, roughness, metallic, ambient occlusion, normal map as parameters
export class Material implements IGPUObject, IInspectorDrawable {
  name: string;

  albedo: vec3 = vec3.create();
  albedoMap: MaterialTexture = new MaterialTexture("rgba8unorm");
  roughness: number = 0;
  roughnessMap: MaterialTexture = new MaterialTexture("r8unorm");
  metallic: number = 0;
  metallicMap: MaterialTexture = new MaterialTexture("r8unorm");
  ambientOcc: number = 1;
  ambientOccMap: MaterialTexture = new MaterialTexture("r8unorm");
  normalMap: MaterialTexture = new MaterialTexture("rgba8unorm");

  hasGPUObjects: boolean = false;
  texSampler: GPUSampler;
  placeholderTexture: GPUTexture;
  placeholderTextureView: GPUTextureView;

  createGPUObjects(device: GPUDevice) {
    if (this.hasGPUObjects) return;
    this.albedoMap.createGPUObjects(device);
    this.roughnessMap.createGPUObjects(device);
    this.metallicMap.createGPUObjects(device);
    this.ambientOccMap.createGPUObjects(device);
    this.normalMap.createGPUObjects(device);

    this.texSampler = device.createSampler({
      minFilter: "linear",
      magFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "mirror-repeat",
      addressModeV: "mirror-repeat",
    });
    this.placeholderTexture = device.createTexture({
      size: { width: 1, height: 1, depthOrArrayLayers: 1 },
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.placeholderTextureView = this.placeholderTexture.createView();
    this.hasGPUObjects = true;
  }

  clearGPUObjects() {
    this.albedoMap.clearGPUObjects();
    this.roughnessMap.clearGPUObjects();
    this.metallicMap.clearGPUObjects();
    this.ambientOccMap.clearGPUObjects();
    this.normalMap.clearGPUObjects();

    this.texSampler = null;
    this.placeholderTexture = this.placeholderTextureView = null;
    this.hasGPUObjects = false;
  }

  private static readonly textureStatusAlbedo = 0x1;
  private static readonly textureStatusRoughness = 0x2;
  private static readonly textureStatusMetallic = 0x4;
  private static readonly textureStatusAmbientOcc = 0x8;
  private static readonly textureStatusNormal = 0x10;

  private getTextureStatus(): number {
    let texStatus = 0;
    if (this.albedoMap.isValid()) texStatus |= Material.textureStatusAlbedo;
    if (this.roughnessMap.isValid()) texStatus |= Material.textureStatusRoughness;
    if (this.metallicMap.isValid()) texStatus |= Material.textureStatusMetallic;
    if (this.ambientOccMap.isValid()) texStatus |= Material.textureStatusAmbientOcc;
    if (this.normalMap.isValid()) texStatus |= Material.textureStatusNormal;
    return texStatus;
  }

  toBindGroup(bg: UniformBindGroup, device: GPUDevice) {
    let matStruct = <UniformPropertyStruct>bg.entries.material.property;
    matStruct.properties.albedo.set(this.albedo);
    matStruct.properties.roughness.set(this.roughness);
    matStruct.properties.metallic.set(this.metallic);
    matStruct.properties.ambientOcc.set(this.ambientOcc);

    bg.getProperty("texStatus").set(this.getTextureStatus());
    if (this.albedoMap.isValid()) bg.getProperty("albedoMap").set(this.albedoMap.gpuTextureView);
    else bg.getProperty("albedoMap").set(this.placeholderTextureView);
    if (this.roughnessMap.isValid()) bg.getProperty("roughnessMap").set(this.roughnessMap.gpuTextureView);
    else bg.getProperty("roughnessMap").set(this.placeholderTextureView);
    if (this.metallicMap.isValid()) bg.getProperty("metallicMap").set(this.metallicMap.gpuTextureView);
    else bg.getProperty("metallicMap").set(this.placeholderTextureView);
    if (this.ambientOccMap.isValid()) bg.getProperty("ambientOccMap").set(this.ambientOccMap.gpuTextureView);
    else bg.getProperty("ambientOccMap").set(this.placeholderTextureView);
    if (this.normalMap.isValid()) bg.getProperty("normalMap").set(this.normalMap.gpuTextureView);
    else bg.getProperty("normalMap").set(this.placeholderTextureView);

    bg.getProperty("texSampler").set(this.texSampler);
  }

  toJSON() {
    const o: any = {
      name: this.name,
      albedo: [this.albedo[0], this.albedo[1], this.albedo[2]],
      roughness: this.roughness,
      metallic: this.metallic,
      ambientOcc: this.ambientOcc,
    };
    if (this.albedoMap.isValid()) o.albedoMap = this.albedoMap.filePath;
    if (this.roughnessMap.isValid()) o.roughnessMap = this.roughnessMap.filePath;
    if (this.metallicMap.isValid()) o.metallicMap = this.metallicMap.filePath;
    if (this.ambientOccMap.isValid()) o.ambientOccMap = this.ambientOccMap.filePath;
    if (this.normalMap.isValid()) o.normalMap = this.normalMap.filePath;
    return o;
  }

  onDrawInspector() {
    ImGui.PushStyleColor(ImGui.ImGuiCol.Text, new ImGui.ImColor(1, 1, 0));
    ImGui.Text("Notice: material is readonly in editor");
    ImGui.PopStyleColor();
    ImGui.LabelText("Name", this.name);
    ImGui.Text("Properties");
    ImGui.ColorEdit3("Albedo", [this.albedo[0], this.albedo[1], this.albedo[2]]);
    ImGui.InputFloat("Roughness", [this.roughness]);
    ImGui.InputFloat("Metallic", [this.metallic]);
    ImGui.InputFloat("Ambient Occlusion", [this.ambientOcc]);
    ImGui.Text("Textures");
    ImGui.LabelText("Albedo", this.albedoMap.isValid() ? this.albedoMap.filePath : "(not set)");
    ImGui.LabelText("Roughness", this.roughnessMap.isValid() ? this.roughnessMap.filePath : "(not set)");
    ImGui.LabelText("Metallic", this.metallicMap.isValid() ? this.metallicMap.filePath : "(not set)");
    ImGui.LabelText("Ambient Occlusion", this.ambientOccMap.isValid() ? this.ambientOccMap.filePath : "(not set)");
    ImGui.LabelText("Normal", this.normalMap.isValid() ? this.normalMap.filePath : "(not set)");
    return false;
  }
}