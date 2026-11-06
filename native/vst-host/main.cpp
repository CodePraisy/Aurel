// Aurel VST3 host.
//
//   aurel-vst-host list <module.vst3>                  JSON list of the module's audio classes
//   aurel-vst-host inspect <module.vst3> <class id>    JSON list of a class's parameters
//   aurel-vst-host serve <sample rate> <block size>    real-time engine for one track
//
// serve keeps a track's instrument and effects loaded and renders audio on
// demand. Aurel's audio clock is the source of truth: every event carries the
// frame (in the output device's sample clock) at which it must be heard, and
// "want F" asks for audio up to frame F. Output is stamped with the frame it
// belongs to, already shifted by the chain's latency (plug-in delay
// compensation), so the caller only has to place it.
//
// stdin  : UTF-8 lines, fields separated by tabs.
// stdout : frames of [u32 type][u32 length][payload]; type 1 = audio
//          ([i64 frame][u32 generation][u32 frames][f32 stereo interleaved]),
//          type 2 = a tab-separated text event.
// stderr : diagnostics; "crash\t<slot>\t<code>" when a plug-in crashes the process.

#include "editor.h"
#include <objbase.h>
#include <fcntl.h>
#include <io.h>

#include "pluginterfaces/base/funknownimpl.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"
#include "pluginterfaces/vst/ivstprocesscontext.h"
#include "pluginterfaces/vst/vstspeaker.h"
#include "public.sdk/source/vst/hosting/eventlist.h"
#include "public.sdk/source/vst/hosting/hostclasses.h"
#include "public.sdk/source/vst/hosting/parameterchanges.h"
#include "public.sdk/source/vst/hosting/plugprovider.h"
#include "public.sdk/source/vst/hosting/processdata.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <condition_variable>
#include <cstdio>
#include <cstring>
#include <deque>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

using namespace Steinberg;
using namespace Steinberg::Vst;
using VST3::Hosting::ClassInfo;
using VST3::Hosting::Module;

namespace aurel {
namespace {

// ---------------------------------------------------------------- text helpers

std::string utf8(const wchar_t* value) {
    const int size = WideCharToMultiByte(CP_UTF8, 0, value, -1, nullptr, 0, nullptr, nullptr);
    if (size <= 1) return {};
    std::string text(size, '\0');
    WideCharToMultiByte(CP_UTF8, 0, value, -1, text.data(), size, nullptr, nullptr);
    text.pop_back();
    return text;
}

std::wstring wide(const std::string& value) {
    const int size = MultiByteToWideChar(CP_UTF8, 0, value.c_str(), -1, nullptr, 0);
    if (size <= 1) return {};
    std::wstring text(size, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, value.c_str(), -1, text.data(), size);
    text.pop_back();
    return text;
}

std::string json(const std::string& text) {
    std::string out = "\"";
    for (const unsigned char c : text) {
        if (c == '"' || c == '\\') { out += '\\'; out += static_cast<char>(c); }
        else if (c >= 32) out += static_cast<char>(c);
    }
    return out + "\"";
}

std::string clean(std::string text) {
    for (auto& c : text) if (c == '\t' || c == '\n' || c == '\r') c = ' ';
    return text;
}

std::vector<std::string> fields(const std::string& line) {
    std::vector<std::string> out;
    size_t start = 0;
    while (true) {
        const auto tab = line.find('\t', start);
        out.push_back(line.substr(start, tab == std::string::npos ? std::string::npos : tab - start));
        if (tab == std::string::npos) return out;
        start = tab + 1;
    }
}

int64 toInt(const std::string& text) { return std::stoll(text); }
double toNumber(const std::string& text) {
    const auto value = std::stod(text);
    if (!std::isfinite(value)) throw std::invalid_argument("not finite");
    return value;
}

// ---------------------------------------------------------------- output

std::mutex outLock;
HANDLE outHandle = INVALID_HANDLE_VALUE;
std::atomic<bool> outBroken{false};

void writeAll(const void* data, size_t size) {
    auto* bytes = static_cast<const char*>(data);
    while (size && !outBroken) {
        DWORD written = 0;
        if (!WriteFile(outHandle, bytes, static_cast<DWORD>(std::min<size_t>(size, 1 << 20)), &written, nullptr) || !written) {
            outBroken = true;
            return;
        }
        bytes += written;
        size -= written;
    }
}

void emit(const std::string& line) {
    std::lock_guard<std::mutex> lock(outLock);
    const uint32 header[2] = {2, static_cast<uint32>(line.size())};
    writeAll(header, sizeof(header));
    writeAll(line.data(), line.size());
}

void emitAudio(int64 frame, uint32 generation, const float* interleaved, uint32 frames) {
    std::lock_guard<std::mutex> lock(outLock);
    const uint32 header[2] = {1, static_cast<uint32>(16 + frames * 8)};
    writeAll(header, sizeof(header));
    writeAll(&frame, 8);
    writeAll(&generation, 4);
    writeAll(&frames, 4);
    writeAll(interleaved, frames * 8);
}

// ---------------------------------------------------------------- crash reporting

thread_local char currentSlot[96] = "";
void setCurrent(const std::string& id) {
    const auto n = std::min<size_t>(id.size(), sizeof(currentSlot) - 1);
    std::memcpy(currentSlot, id.data(), n);
    currentSlot[n] = 0;
}
struct Current {
    explicit Current(const std::string& id) { setCurrent(id); }
    ~Current() { currentSlot[0] = 0; }
};

LONG WINAPI crashFilter(EXCEPTION_POINTERS* info) {
    char text[160];
    const auto code = info && info->ExceptionRecord ? info->ExceptionRecord->ExceptionCode : 0;
    const int n = std::snprintf(text, sizeof(text), "crash\t%s\t%08lX\n", currentSlot, static_cast<unsigned long>(code));
    DWORD written = 0;
    WriteFile(GetStdHandle(STD_ERROR_HANDLE), text, n > 0 ? n : 0, &written, nullptr);
    TerminateProcess(GetCurrentProcess(), 3);
    return EXCEPTION_EXECUTE_HANDLER;
}

// ---------------------------------------------------------------- plug-in instance

bool isInstrument(const ClassInfo& info) {
    const auto& categories = info.subCategories();
    return std::find(categories.begin(), categories.end(), "Instrument") != categories.end();
}

struct Instance;

/** Receives edits from the plug-in's own editor and forwards them to the audio thread. */
struct ComponentHandler final : public U::Implements<U::Directly<IComponentHandler>> {
    Instance* owner = nullptr;
    tresult PLUGIN_API beginEdit(ParamID) override { return kResultOk; }
    tresult PLUGIN_API performEdit(ParamID id, ParamValue value) override;
    tresult PLUGIN_API endEdit(ParamID) override { return kResultOk; }
    tresult PLUGIN_API restartComponent(int32 flags) override;
};

struct Instance {
    std::string id, name, path, classId;
    std::filesystem::path stateDir;
    bool instrument = false;
    std::atomic<bool> on{true};
    std::atomic<bool> failed{false};
    std::atomic<bool> restartRequested{false};
    std::shared_ptr<Module> module;
    IPtr<PlugProvider> provider;
    IPtr<IComponent> component;
    IPtr<IEditController> controller;
    IPtr<IAudioProcessor> processor;
    IPtr<ComponentHandler> handler;
    std::unique_ptr<EditorWindow> editor;
    HostProcessData data;
    std::unique_ptr<EventList> events = std::make_unique<EventList>(1024);
    std::unique_ptr<ParameterChanges> changes = std::make_unique<ParameterChanges>(256);
    int32 latency = 0;
    bool processing = false;
    std::mutex paramLock;
    std::vector<std::pair<ParamID, ParamValue>> pendingParams;
    std::map<ParamID, ParamValue> changed;
    std::array<int, 128> held{};

    void queueParam(ParamID id, ParamValue value) {
        if (!std::isfinite(value)) return;
        std::lock_guard<std::mutex> lock(paramLock);
        pendingParams.emplace_back(id, std::clamp(value, 0., 1.));
        changed[id] = value;
    }
};

tresult PLUGIN_API ComponentHandler::performEdit(ParamID id, ParamValue value) {
    if (owner) owner->queueParam(id, value);
    return kResultOk;
}
tresult PLUGIN_API ComponentHandler::restartComponent(int32 flags) {
    if (owner && (flags & (RestartFlags::kLatencyChanged | RestartFlags::kIoChanged))) owner->restartRequested = true;
    return kResultOk;
}

std::map<std::string, std::shared_ptr<Module>> modules;
IPtr<HostApplication> hostApplication;

std::shared_ptr<Module> openModule(const std::string& path) {
    const auto hit = modules.find(path);
    if (hit != modules.end()) return hit->second;
    std::string error;
    auto module = Module::create(path, error);
    if (!module) throw std::runtime_error(error.empty() ? "The plug-in file could not be loaded." : error);
    module->getFactory().setHostContext(hostApplication);
    modules[path] = module;
    return module;
}

void readParams(Instance& inst) {
    std::ifstream file(inst.stateDir / "params.txt");
    for (std::string line; std::getline(file, line);) {
        const auto separator = line.find('=');
        if (separator == std::string::npos) continue;
        try {
            const auto id = static_cast<ParamID>(std::stoul(line.substr(0, separator)));
            const auto value = std::clamp(toNumber(line.substr(separator + 1)), 0., 1.);
            if (inst.controller) inst.controller->setParamNormalized(id, value);
            std::lock_guard<std::mutex> lock(inst.paramLock);
            inst.pendingParams.emplace_back(id, value);
        } catch (...) {}
    }
}

/** Bus layout, processing setup and activation. UI thread. */
void configure(Instance& inst, double sampleRate, int32 maxBlock) {
    auto& component = *inst.component;
    auto* processor = inst.processor.get();
    if (processor->canProcessSampleSize(kSample32) != kResultOk) throw std::runtime_error("The plug-in does not accept 32-bit audio.");
    const int inputCount = component.getBusCount(kAudio, kInput);
    const int outputCount = component.getBusCount(kAudio, kOutput);
    if (outputCount <= 0 || (!inst.instrument && inputCount <= 0)) throw std::runtime_error("The plug-in has no usable audio buses.");
    std::vector<SpeakerArrangement> in(inputCount), out(outputCount);
    for (int i = 0; i < inputCount; ++i) processor->getBusArrangement(kInput, i, in[i]);
    for (int i = 0; i < outputCount; ++i) processor->getBusArrangement(kOutput, i, out[i]);
    if (!in.empty() && !inst.instrument) in[0] = SpeakerArr::kStereo;
    out[0] = SpeakerArr::kStereo;
    if (processor->setBusArrangements(in.data(), inputCount, out.data(), outputCount) != kResultOk) {
        for (int i = 0; i < inputCount; ++i) processor->getBusArrangement(kInput, i, in[i]);
        for (int i = 0; i < outputCount; ++i) processor->getBusArrangement(kOutput, i, out[i]);
    }
    for (int i = 0; i < inputCount; ++i) component.activateBus(kAudio, kInput, i, i == 0 && !inst.instrument);
    for (int i = 0; i < outputCount; ++i) component.activateBus(kAudio, kOutput, i, i == 0);
    if (inst.instrument) {
        if (component.getBusCount(kEvent, kInput) <= 0) throw std::runtime_error("The instrument has no MIDI note input.");
        component.activateBus(kEvent, kInput, 0, true);
    }
    ProcessSetup setup{kRealtime, kSample32, maxBlock, sampleRate};
    if (processor->setupProcessing(setup) != kResultOk) throw std::runtime_error("The plug-in refused this sample rate or buffer size.");
    if (!inst.data.prepare(component, maxBlock, kSample32)) throw std::runtime_error("Could not create the plug-in's audio buffers.");
    inst.data.processMode = kRealtime;
    if (inst.data.numOutputs <= 0 || inst.data.outputs[0].numChannels <= 0 ||
        (!inst.instrument && (inst.data.numInputs <= 0 || inst.data.inputs[0].numChannels <= 0)))
        throw std::runtime_error("The plug-in has no usable audio buses.");
    if (component.setActive(true) != kResultOk) throw std::runtime_error("Could not activate the plug-in.");
    inst.latency = std::clamp<int32>(static_cast<int32>(processor->getLatencySamples()), 0, static_cast<int32>(sampleRate * 2));
}

std::shared_ptr<Instance> create(const std::string& id, const std::string& name, const std::string& path, const std::string& classId,
                                 const std::filesystem::path& stateDir, double sampleRate, int32 maxBlock) {
    Current current(id);
    auto inst = std::make_shared<Instance>();
    inst->id = id;
    inst->name = name;
    inst->path = path;
    inst->classId = classId;
    inst->stateDir = stateDir;
    inst->module = openModule(path);
    const auto classes = inst->module->getFactory().classInfos();
    const auto selected = std::find_if(classes.begin(), classes.end(), [&](const ClassInfo& info) {
        return info.category() == kVstAudioEffectClass && info.ID().toString() == classId;
    });
    if (selected == classes.end()) throw std::runtime_error("This plug-in is no longer installed in that file.");
    inst->instrument = isInstrument(*selected);
    inst->provider = owned(new PlugProvider(inst->module->getFactory(), *selected, true));
    if (!inst->provider->initialize()) throw std::runtime_error("The plug-in could not be initialized.");
    inst->component = inst->provider->getComponentPtr();
    inst->controller = inst->provider->getControllerPtr();
    inst->processor = FUnknownPtr<IAudioProcessor>(inst->component);
    if (!inst->processor) throw std::runtime_error("This is not an audio plug-in.");
    restorePluginState(*inst->component, inst->controller, stateDir);
    readParams(*inst);
    inst->handler = owned(new ComponentHandler);
    inst->handler->owner = inst.get();
    if (inst->controller) inst->controller->setComponentHandler(inst->handler);
    configure(*inst, sampleRate, maxBlock);
    return inst;
}

void deactivate(Instance& inst) {
    Current current(inst.id);
    if (inst.editor) inst.editor.reset();
    if (inst.controller) inst.controller->setComponentHandler(nullptr);
    if (inst.handler) inst.handler->owner = nullptr;
    if (inst.component) inst.component->setActive(false);
}

// ---------------------------------------------------------------- engine state

double sampleRate = 48000;
int32 blockSize = 256;

/** Audio-thread events, ordered by the processing frame at which they apply. */
struct Event {
    int64 frame = 0;
    int type = 0; // 0 note off, 1 note on, 2 all notes off, 3 file
    int pitch = 0, velocity = 0;
    int64 offset = 0;
    std::string path;
    uint64 order = 0;
};

struct FileSource {
    std::string path;
    FILE* file = nullptr;
    int64 frames = 0;
    int64 start = 0;  // processing frame where `offset` plays
    int64 offset = 0; // frame in the file
    ~FileSource() { if (file) std::fclose(file); }
};

std::mutex chainLock; // held by the audio thread while processing a block
std::vector<std::shared_ptr<Instance>> chain;
std::atomic<int32> chainLatency{0};

struct Command {
    std::string line;
    std::vector<float> pcm; // "input" commands carry live audio
};

std::mutex commandLock;
std::condition_variable commandReady;
std::deque<Command> audioCommands;
std::atomic<bool> quitting{false};

std::deque<std::string> uiCommands;
HANDLE uiEvent = nullptr;

// ---------------------------------------------------------------- audio thread

class Renderer {
public:
    void run() {
        CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        std::deque<Command> local;
        while (!quitting) {
            {
                std::unique_lock<std::mutex> lock(commandLock);
                commandReady.wait_for(lock, std::chrono::milliseconds(250), [&] { return !audioCommands.empty() || quitting; });
                local.swap(audioCommands);
            }
            for (auto& command : local) apply(command);
            local.clear();
            render();
        }
        CoUninitialize();
    }

private:
    int64 q = 0;              // next presentation frame to emit
    int64 want = 0;           // emit up to here
    int64 discardBefore = 0;  // after a reset, output earlier than this is pre-roll
    uint32 generation = 0;
    uint64 order = 0;
    double tempo = 120;
    int sigNum = 4, sigDen = 4;
    bool playing = false;
    std::vector<Event> events;
    std::map<int64, std::vector<float>> input; // live audio chunks by first frame
    std::unique_ptr<FileSource> file;
    std::map<std::string, std::unique_ptr<FileSource>> openFiles;
    std::vector<float> left, right, out;
    int64 silentFrames = 0;

    void insert(Event event) {
        event.order = order++;
        const auto at = std::upper_bound(events.begin(), events.end(), event, [](const Event& a, const Event& b) {
            if (a.frame != b.frame) return a.frame < b.frame;
            return a.order < b.order;
        });
        events.insert(at, std::move(event));
    }

    void apply(Command& command) {
        const auto& line = command.line;
        try {
            const auto f = fields(line);
            const auto& op = f[0];
            if (op == "want" && f.size() >= 2) want = std::max(want, toInt(f[1]));
            else if (op == "input" && f.size() >= 4) {
                // Live audio from Aurel's own instruments, stamped with the frame it must be heard at.
                if (static_cast<uint32>(toInt(f[1])) != generation || command.pcm.empty()) return;
                const auto frame = toInt(f[2]);
                input[frame] = std::move(command.pcm);
                while (input.size() > 4096) input.erase(input.begin());
            }
            else if (op == "on" && f.size() >= 4) insert({toInt(f[1]), 1, static_cast<int>(std::clamp<int64>(toInt(f[2]), 0, 127)), static_cast<int>(std::clamp<int64>(toInt(f[3]), 1, 127))});
            else if (op == "off" && f.size() >= 3) insert({toInt(f[1]), 0, static_cast<int>(std::clamp<int64>(toInt(f[2]), 0, 127)), 0});
            else if (op == "alloff" && f.size() >= 2) insert({toInt(f[1]), 2});
            else if (op == "file" && f.size() >= 2) {
                Event event{toInt(f[1]), 3};
                event.offset = f.size() >= 4 ? toInt(f[2]) : 0;
                event.path = f.size() >= 4 ? f[3] : "";
                insert(std::move(event));
            } else if (op == "tempo" && f.size() >= 2) {
                tempo = std::clamp(toNumber(f[1]), 10., 1000.);
                if (f.size() >= 4) { sigNum = static_cast<int>(toInt(f[2])); sigDen = static_cast<int>(toInt(f[3])); }
            } else if (op == "playing" && f.size() >= 2) playing = f[1] == "1";
            else if (op == "reset" && f.size() >= 3) {
                // Drop the old timeline. The caller resends everything from `frame` on.
                generation = static_cast<uint32>(toInt(f[1]));
                const auto frame = toInt(f[2]);
                events.clear();
                file.reset();
                input.clear();
                insert({frame, 2});
                q = frame - chainLatency;
                discardBefore = frame;
                want = std::max(want, frame);
                silentFrames = 0;
            }
        } catch (...) {
            emit("log\tbad audio command: " + clean(line.substr(0, 80)));
        }
    }

    FILE* openFile(const std::string& path, int64& frames) {
        auto& entry = openFiles[path];
        if (!entry) {
            entry = std::make_unique<FileSource>();
            entry->file = _wfopen(wide(path).c_str(), L"rb");
            if (entry->file) {
                _fseeki64(entry->file, 0, SEEK_END);
                entry->frames = _ftelli64(entry->file) / 8;
            } else emit("log\tcould not open " + clean(path));
        }
        frames = entry->frames;
        return entry->file;
    }

    void readFile(int64 processFrame, float* l, float* r, int count) {
        if (!file || file->path.empty() || processFrame + count <= file->start) return;
        int skip = static_cast<int>(std::max<int64>(0, file->start - processFrame));
        int64 index = file->offset + (processFrame + skip - file->start);
        int64 frames = 0;
        FILE* handle = openFile(file->path, frames);
        if (!handle || index >= frames) return;
        const int n = static_cast<int>(std::min<int64>(count - skip, frames - index));
        if (n <= 0 || index < 0) return;
        static std::vector<float> scratch;
        scratch.resize(static_cast<size_t>(n) * 2);
        _fseeki64(handle, index * 8, SEEK_SET);
        const auto got = std::fread(scratch.data(), 8, static_cast<size_t>(n), handle);
        for (size_t i = 0; i < got; ++i) {
            l[skip + i] += scratch[2 * i];
            r[skip + i] += scratch[2 * i + 1];
        }
    }

    bool idle() const {
        if (file && !file->path.empty()) return false;
        if (!events.empty() || !input.empty()) return false;
        for (const auto& inst : chain) for (const int count : inst->held) if (count) return false;
        return silentFrames > static_cast<int64>(sampleRate * 2);
    }

    void render() {
        if (q >= want) return;
        std::lock_guard<std::mutex> lock(chainLock);
        const int64 maxChunk = 4096;
        out.resize(static_cast<size_t>(maxChunk) * 2);
        int64 chunkStart = q;
        uint32 chunkFrames = 0;
        auto flush = [&] {
            if (!chunkFrames) return;
            emitAudio(chunkStart, generation, out.data(), chunkFrames);
            chunkFrames = 0;
        };
        while (q < want && !quitting) {
            if (idle()) {
                // Nothing can sound: skip ahead instead of burning CPU on silence. An empty
                // audio frame still tells the caller the track is alive.
                flush();
                q = want;
                emitAudio(q, generation, out.data(), 0);
                break;
            }
            const int n = blockSize;
            const int64 p = q + chainLatency;
            processBlock(p, n);
            float peak = 0;
            for (int i = 0; i < n; ++i) peak = std::max(peak, std::max(std::abs(left[i]), std::abs(right[i])));
            silentFrames = peak < 1e-5f ? silentFrames + n : 0;
            int from = 0;
            if (q < discardBefore) from = static_cast<int>(std::min<int64>(n, discardBefore - q));
            for (int i = from; i < n; ++i) {
                if (chunkFrames == 0) chunkStart = q + i;
                out[2 * chunkFrames] = left[i];
                out[2 * chunkFrames + 1] = right[i];
                if (++chunkFrames == maxChunk) flush();
            }
            q += n;
            if (chunkFrames && q < want && commandsWaiting()) break; // pick up a reset quickly
        }
        flush();
    }

    bool commandsWaiting() {
        std::lock_guard<std::mutex> lock(commandLock);
        return !audioCommands.empty();
    }

    void noteEvent(Instance& inst, const Event& event, int offset, double projectFrame) {
        auto send = [&](int pitch, bool on, int velocity) {
            Steinberg::Vst::Event e{};
            e.busIndex = 0;
            e.sampleOffset = offset;
            e.ppqPosition = projectFrame / sampleRate * tempo / 60.;
            if (on) {
                e.type = Steinberg::Vst::Event::kNoteOnEvent;
                e.noteOn = {0, static_cast<int16>(pitch), 0.f, velocity / 127.f, 0, -1};
            } else {
                e.type = Steinberg::Vst::Event::kNoteOffEvent;
                e.noteOff = {0, static_cast<int16>(pitch), 0.f, -1, 0.f};
            }
            inst.events->addEvent(e);
        };
        if (event.type == 1) {
            send(event.pitch, true, event.velocity);
            ++inst.held[event.pitch];
        } else if (event.type == 0) {
            if (inst.held[event.pitch] > 0 && --inst.held[event.pitch] > 0) return; // an overlapping copy still holds it
            send(event.pitch, false, 0);
        } else if (event.type == 2) {
            for (int pitch = 0; pitch < 128; ++pitch) if (inst.held[pitch]) { send(pitch, false, 0); inst.held[pitch] = 0; }
        }
    }

    void processBlock(int64 p, int n) {
        left.assign(n, 0.f);
        right.assign(n, 0.f);
        Instance* instrument = !chain.empty() && chain.front()->instrument ? chain.front().get() : nullptr;
        if (instrument) instrument->events->clear();
        // Walk the events inside this block; the file source is switched sample-accurately.
        int cursor = 0;
        size_t used = 0;
        while (used < events.size() && events[used].frame < p + n) {
            const auto& event = events[used++];
            const int offset = static_cast<int>(std::clamp<int64>(event.frame - p, 0, n - 1));
            if (event.type == 3) {
                readFile(p + cursor, left.data() + cursor, right.data() + cursor, offset - cursor);
                cursor = offset;
                file.reset();
                if (!event.path.empty()) {
                    file = std::make_unique<FileSource>();
                    file->path = event.path;
                    file->start = std::max(event.frame, p + offset);
                    file->offset = event.offset + (file->start - event.frame);
                }
            } else if (instrument) noteEvent(*instrument, event, offset, static_cast<double>(p + offset));
            else if (event.type == 2) for (auto& inst : chain) inst->held.fill(0);
        }
        events.erase(events.begin(), events.begin() + static_cast<std::ptrdiff_t>(used));
        readFile(p + cursor, left.data() + cursor, right.data() + cursor, n - cursor);
        for (auto it = input.begin(); it != input.end();) {
            const int64 start = it->first;
            const int64 frames = static_cast<int64>(it->second.size() / 2);
            if (start + frames <= p) { it = input.erase(it); continue; }
            if (start >= p + n) break;
            for (int64 t = std::max(start, p); t < std::min(start + frames, p + n); ++t) {
                left[t - p] += it->second[2 * (t - start)];
                right[t - p] += it->second[2 * (t - start) + 1];
            }
            ++it;
        }

        ProcessContext context{};
        context.state = (playing ? ProcessContext::kPlaying : 0) | ProcessContext::kTempoValid |
                        ProcessContext::kProjectTimeMusicValid | ProcessContext::kTimeSigValid;
        context.sampleRate = sampleRate;
        context.tempo = tempo;
        context.timeSigNumerator = sigNum;
        context.timeSigDenominator = sigDen;
        context.projectTimeSamples = p;
        context.projectTimeMusic = p / sampleRate * tempo / 60.;

        for (const auto& shared : chain) {
            auto& inst = *shared;
            if (inst.failed) { if (inst.instrument) { left.assign(n, 0.f); right.assign(n, 0.f); } continue; }
            if (!inst.on) {
                if (inst.instrument) { left.assign(n, 0.f); right.assign(n, 0.f); inst.events->clear(); }
                continue;
            }
            Current current(inst.id);
            auto& data = inst.data;
            for (int bus = 0; bus < data.numInputs; ++bus) {
                auto& in = data.inputs[bus];
                in.silenceFlags = bus == 0 && !inst.instrument ? 0 : HostProcessData::kAllChannelsSilent;
                for (int ch = 0; ch < in.numChannels; ++ch) {
                    auto* channel = in.channelBuffers32[ch];
                    for (int i = 0; i < n; ++i) {
                        channel[i] = bus || ch > 1 || inst.instrument ? 0.f
                            : in.numChannels == 1 ? (left[i] + right[i]) * .5f : (ch ? right[i] : left[i]);
                    }
                }
            }
            for (int bus = 0; bus < data.numOutputs; ++bus) data.outputs[bus].silenceFlags = 0;
            {
                std::lock_guard<std::mutex> lock(inst.paramLock);
                for (const auto& [id, value] : inst.pendingParams) {
                    int32 index = 0;
                    if (auto* queue = inst.changes->addParameterData(id, index)) queue->addPoint(0, value, index);
                }
                inst.pendingParams.clear();
            }
            data.numSamples = n;
            data.processContext = &context;
            data.inputParameterChanges = inst.changes.get();
            data.inputEvents = inst.instrument ? inst.events.get() : nullptr;
            try {
                if (!inst.processing) { inst.processor->setProcessing(true); inst.processing = true; }
                inst.processor->process(data);
            } catch (...) {
                inst.failed = true;
                emit("fail\t" + inst.id + "\tThe plug-in stopped while processing audio and was bypassed.");
            }
            inst.changes->clearQueue();
            if (inst.instrument) inst.events->clear();
            const auto& bus = data.outputs[0];
            for (int ch = 0; ch < 2; ++ch) {
                const float* source = bus.channelBuffers32[std::min(ch, bus.numChannels - 1)];
                auto& target = ch ? right : left;
                for (int i = 0; i < n; ++i) {
                    const float v = source[i];
                    target[i] = std::isfinite(v) ? std::clamp(v, -8.f, 8.f) : 0.f;
                }
            }
        }
    }
};

Renderer renderer;

// ---------------------------------------------------------------- UI thread

struct SlotSpec {
    std::string id, name, path, classId, stateDir;
    bool on = true, restore = false;
};
std::vector<SlotSpec> pending;
HWND owner = nullptr;

std::shared_ptr<Instance> findInstance(const std::string& id) {
    for (const auto& inst : chain) if (inst->id == id) return inst;
    return nullptr;
}

void recomputeLatency() {
    int32 total = 0;
    for (const auto& inst : chain) if (inst->on && !inst->failed) total += inst->latency;
    chainLatency = total;
}

void commit(const std::string& seq) {
    std::vector<std::shared_ptr<Instance>> next;
    std::vector<std::shared_ptr<Instance>> fresh;
    for (const auto& spec : pending) {
        auto existing = findInstance(spec.id);
        if (existing && existing->path == spec.path && existing->classId == spec.classId && !existing->failed) {
            existing->on = spec.on;
            existing->name = spec.name;
            existing->stateDir = spec.stateDir;
            if (spec.restore) {
                std::lock_guard<std::mutex> lock(chainLock);
                Current current(existing->id);
                restorePluginState(*existing->component, existing->controller, existing->stateDir);
                readParams(*existing);
            }
            next.push_back(existing);
            continue;
        }
        try {
            auto inst = create(spec.id, spec.name, spec.path, spec.classId, spec.stateDir, sampleRate, blockSize);
            inst->on = spec.on;
            if (!next.empty() && inst->instrument) throw std::runtime_error("Only one instrument can be loaded per track.");
            next.push_back(inst);
            fresh.push_back(inst);
        } catch (const std::exception& error) {
            emit("fail\t" + spec.id + "\t" + clean(error.what()));
        } catch (...) {
            emit("fail\t" + spec.id + "\tThe plug-in could not be loaded.");
        }
    }
    pending.clear();
    std::vector<std::shared_ptr<Instance>> removed;
    {
        std::lock_guard<std::mutex> lock(chainLock);
        for (const auto& inst : chain)
            if (std::find(next.begin(), next.end(), inst) == next.end()) {
                if (inst->processing) { Current current(inst->id); inst->processor->setProcessing(false); inst->processing = false; }
                removed.push_back(inst);
            }
        chain = next;
        recomputeLatency();
    }
    for (auto& inst : removed) deactivate(*inst);
    removed.clear();
    emit("chain\t" + seq + "\t" + std::to_string(chainLatency.load()));
}

void writeChanged(Instance& inst) {
    std::map<ParamID, ParamValue> values;
    {
        std::lock_guard<std::mutex> lock(inst.paramLock);
        values.swap(inst.changed);
    }
    std::ofstream file(inst.stateDir / "changed.txt", std::ios::trunc);
    for (const auto& [id, value] : values) file << id << "=" << std::setprecision(16) << value << "\n";
}

void save(Instance& inst) {
    Current current(inst.id);
    savePluginState(*inst.component, inst.controller, inst.stateDir);
    writeChanged(inst);
    emit("saved\t" + inst.id);
}

void restart(Instance& inst) {
    // Required by VST3 when a plug-in reports new latency or buses.
    std::lock_guard<std::mutex> lock(chainLock);
    Current current(inst.id);
    if (inst.processing) { inst.processor->setProcessing(false); inst.processing = false; }
    inst.component->setActive(false);
    inst.latency = std::clamp<int32>(static_cast<int32>(inst.processor->getLatencySamples()), 0, static_cast<int32>(sampleRate * 2));
    inst.component->setActive(true);
    recomputeLatency();
    emit("latency\t" + std::to_string(chainLatency.load()));
}

void listParameters(Instance& inst) {
    std::ostringstream out;
    out << "[";
    bool first = true;
    auto* controller = inst.controller.get();
    for (int32 i = 0; controller && i < controller->getParameterCount(); ++i) {
        ParameterInfo info{};
        if (controller->getParameterInfo(i, info) != kResultOk ||
            (info.flags & (ParameterInfo::kIsReadOnly | ParameterInfo::kIsHidden))) continue;
        if (!first) out << ",";
        first = false;
        out << "{\"id\":" << info.id << ",\"label\":" << json(utf8(reinterpret_cast<const wchar_t*>(info.title)))
            << ",\"value\":" << controller->getParamNormalized(info.id) << ",\"steps\":" << info.stepCount << "}";
    }
    out << "]";
    emit("params\t" + inst.id + "\t" + out.str());
}

void uiCommand(const std::string& line) {
    const auto f = fields(line);
    const auto& op = f[0];
    try {
        if (op == "slot" && f.size() >= 8) {
            // slot <id> <on> <restore> <name> <class id> <state dir> <module path>
            pending.push_back({f[1], f[4], f[7], f[5], f[6], f[2] == "1", f[3] == "1"});
        } else if (op == "commit" && f.size() >= 2) commit(f[1]);
        else if (op == "param" && f.size() >= 4) {
            if (auto inst = findInstance(f[1])) {
                const auto id = static_cast<ParamID>(std::stoul(f[2]));
                const auto value = std::clamp(toNumber(f[3]), 0., 1.);
                if (inst->controller) inst->controller->setParamNormalized(id, value);
                inst->queueParam(id, value);
            }
        } else if (op == "edit" && f.size() >= 2) {
            auto inst = findInstance(f[1]);
            if (!inst || !inst->controller) { emit("editfail\t" + f[1] + "\tThis plug-in has no editor."); return; }
            if (inst->editor && inst->editor->isOpen()) { inst->editor->focus(); return; }
            if (f.size() >= 4) owner = reinterpret_cast<HWND>(static_cast<intptr_t>(toInt(f[3])));
            try {
                Current current(inst->id);
                std::weak_ptr<Instance> weak = inst;
                const auto title = L"Aurel — " + wide(f.size() >= 3 && !f[2].empty() ? f[2] : inst->name);
                inst->editor = std::make_unique<EditorWindow>(*inst->controller, title, owner, [weak] {
                    if (auto self = weak.lock()) {
                        try { save(*self); } catch (const std::exception& error) { emit("editfail\t" + self->id + "\t" + clean(error.what())); }
                        emit("editor\t" + self->id + "\t0");
                    }
                });
                emit("editor\t" + inst->id + "\t1");
            } catch (const std::exception& error) {
                inst->editor.reset();
                emit("editfail\t" + inst->id + "\t" + clean(error.what()));
            }
        } else if (op == "closeeditor" && f.size() >= 2) {
            if (auto inst = findInstance(f[1]); inst && inst->editor) inst->editor->close();
        } else if (op == "save" && f.size() >= 2) {
            if (auto inst = findInstance(f[1])) save(*inst);
        } else if (op == "params" && f.size() >= 2) {
            if (auto inst = findInstance(f[1])) listParameters(*inst);
            else emit("params\t" + f[1] + "\t[]");
        } else if (op == "flush") {
            // Silence effect tails: deactivate and reactivate every plug-in.
            std::lock_guard<std::mutex> lock(chainLock);
            for (const auto& inst : chain) {
                Current current(inst->id);
                if (inst->processing) { inst->processor->setProcessing(false); inst->processing = false; }
                inst->component->setActive(false);
                inst->component->setActive(true);
                inst->held.fill(0);
            }
        } else if (op == "quit") quitting = true;
    } catch (const std::exception& error) {
        emit("log\t" + clean(op) + ": " + clean(error.what()));
    }
}

void readInput() {
    std::string line;
    while (std::getline(std::cin, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (line.empty()) continue;
        const auto op = line.substr(0, line.find('\t'));
        const bool audio = op == "want" || op == "on" || op == "off" || op == "alloff" || op == "file" ||
                           op == "tempo" || op == "playing" || op == "reset" || op == "input";
        Command command{std::move(line), {}};
        if (op == "input") {
            // input <generation> <frame> <frames>, then frames * 2 floats of raw audio
            const auto f = fields(command.line);
            int64 frames = 0;
            try { frames = f.size() >= 4 ? toInt(f[3]) : 0; } catch (...) {}
            if (frames <= 0 || frames > 65536) break; // the stream is out of sync; stop reading
            command.pcm.resize(static_cast<size_t>(frames) * 2);
            if (!std::cin.read(reinterpret_cast<char*>(command.pcm.data()), frames * 8)) break;
        }
        {
            std::lock_guard<std::mutex> lock(commandLock);
            if (audio) audioCommands.push_back(std::move(command));
            else uiCommands.push_back(std::move(command.line));
        }
        if (audio) commandReady.notify_one();
        else SetEvent(uiEvent);
    }
    quitting = true;
    commandReady.notify_all();
    SetEvent(uiEvent);
}

int serve(int argc, wchar_t** argv) {
    if (argc >= 3) sampleRate = std::clamp(std::stod(utf8(argv[2])), 8000., 384000.);
    if (argc >= 4) blockSize = static_cast<int32>(std::clamp(std::stoi(utf8(argv[3])), 32, 4096));
    uiEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    std::thread audio([] { renderer.run(); });
    std::thread input(readInput);
    input.detach();
    emit("ready\t2");
    while (!quitting) {
        const auto wait = MsgWaitForMultipleObjectsEx(1, &uiEvent, 200, QS_ALLINPUT, MWMO_INPUTAVAILABLE);
        if (wait == WAIT_OBJECT_0) {
            std::deque<std::string> local;
            {
                std::lock_guard<std::mutex> lock(commandLock);
                local.swap(uiCommands);
            }
            for (const auto& line : local) { uiCommand(line); if (quitting) break; }
        }
        MSG message{};
        while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        for (const auto& inst : chain) if (inst->restartRequested.exchange(false)) restart(*inst);
    }
    commandReady.notify_all();
    audio.join();
    std::lock_guard<std::mutex> lock(chainLock);
    for (auto& inst : chain) {
        if (inst->processing) inst->processor->setProcessing(false);
        deactivate(*inst);
    }
    chain.clear();
    return 0;
}

// ---------------------------------------------------------------- one-shot operations

void list(const Module& module) {
    std::cout << "[";
    bool first = true;
    for (const auto& info : module.getFactory().classInfos()) {
        if (info.category() != kVstAudioEffectClass) continue;
        if (!first) std::cout << ",";
        first = false;
        std::cout << "{\"id\":" << json(info.ID().toString()) << ",\"name\":" << json(info.name()) << ",\"vendor\":" << json(info.vendor())
                  << ",\"kind\":\"" << (isInstrument(info) ? "instrument" : "effect") << "\"}";
    }
    std::cout << "]\n";
}

} // namespace
} // namespace aurel

int wmain(int argc, wchar_t** argv) {
    using namespace aurel;
    SetUnhandledExceptionFilter(crashFilter);
    SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX);
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
    outHandle = GetStdHandle(STD_OUTPUT_HANDLE);
    const auto com = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    hostApplication = owned(new HostApplication);
    PluginContextFactory::instance().setPluginContext(hostApplication);
    int result = 0;
    try {
        if (argc < 2) throw std::runtime_error("Expected an operation.");
        const auto op = utf8(argv[1]);
        if (op == "serve") result = serve(argc, argv);
        else {
            if (argc < 3) throw std::runtime_error("Expected a VST3 path.");
            std::string error;
            auto module = Module::create(utf8(argv[2]), error);
            if (!module) throw std::runtime_error(error.empty() ? "The plug-in file could not be loaded." : error);
            module->getFactory().setHostContext(hostApplication);
            if (op == "list") list(*module);
            else if (op == "inspect" && argc >= 4) {
                const auto classId = utf8(argv[3]);
                const auto classes = module->getFactory().classInfos();
                const auto selected = std::find_if(classes.begin(), classes.end(), [&](const ClassInfo& info) {
                    return info.category() == kVstAudioEffectClass && info.ID().toString() == classId;
                });
                if (selected == classes.end()) throw std::runtime_error("This plug-in is no longer installed.");
                auto provider = owned(new PlugProvider(module->getFactory(), *selected, true));
                if (!provider->initialize()) throw std::runtime_error("The plug-in could not be initialized.");
                Instance inst;
                inst.controller = provider->getControllerPtr();
                inst.id = "inspect";
                std::ostringstream ignored;
                if (inst.controller) {
                    std::cout << "[";
                    bool first = true;
                    for (int32 i = 0; i < inst.controller->getParameterCount(); ++i) {
                        ParameterInfo info{};
                        if (inst.controller->getParameterInfo(i, info) != kResultOk ||
                            (info.flags & (ParameterInfo::kIsReadOnly | ParameterInfo::kIsHidden))) continue;
                        if (!first) std::cout << ",";
                        first = false;
                        std::cout << "{\"id\":" << info.id << ",\"label\":" << json(utf8(reinterpret_cast<const wchar_t*>(info.title)))
                                  << ",\"value\":" << inst.controller->getParamNormalized(info.id) << ",\"steps\":" << info.stepCount << "}";
                    }
                    std::cout << "]\n";
                } else std::cout << "[]\n";
            } else throw std::runtime_error("Unrecognized VST3 operation.");
        }
    } catch (const std::exception& error) {
        std::cerr << error.what() << "\n";
        result = 1;
    }
    hostApplication = nullptr;
    modules.clear();
    if (SUCCEEDED(com)) CoUninitialize();
    std::cout.flush();
    return result;
}
