
const $ = (id) => document.getElementById(id);

console.log(" app.js foi carregado!");

let services = [];
let booking = null;
let qrCreated = false;

// Inicialização da página
$("year").textContent = new Date().getFullYear();

// Data atual no formato AAAA-MM-DD
const today = () => {
    const date = new Date();

    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

$("date").min = today();

// Formatação de valores em reais
const money = (value) =>
    Number(value).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL"
    });

// Serviços selecionados
const selected = () =>
    [...document.querySelectorAll(".service-check:checked")]
        .map((input) => services.find((service) => String(service.id) === input.value))
        .filter(Boolean);

// Soma dos serviços selecionados
const total = () =>
    selected().reduce((sum, service) => sum + Number(service.price), 0);

// Proteção básica para textos inseridos no HTML
const escapeHtml = (value) =>
    String(value).replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[character]);

// Navegação entre as etapas
function step(number) {
    const panels = [
        "customerPanel",
        "schedulePanel",
        "paymentPanel",
        "successPanel"
    ];

    panels.forEach((id, index) => {
        const panel = $(id);

        if (panel) {
            panel.classList.toggle("hidden", index !== number - 1);
        }
    });

    ["step1", "step2", "step3"].forEach((id, index) => {
        const element = $(id);

        if (!element) return;

        element.classList.toggle("active", index === number - 1);

        if (index === number - 1) {
            element.setAttribute("aria-current", "step");
        } else {
            element.removeAttribute("aria-current");
        }
    });

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}

// Requisições para a API
async function api(url, options = {}) {
    const response = await fetch(url, {
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        },
        ...options
    });

    const data = await response.json().catch(() => ({
        error: "Resposta inválida do servidor."
    }));

    if (!response.ok) {
        throw new Error(data.error || "Ocorreu um erro.");
    }

    return data;
}

// Carregar serviços disponíveis
async function loadServices() {
    try {
        services = await api("/api/services");

        $("services").innerHTML = services.map((service) => `
            <label class="service-option">
                <input
                    class="service-check"
                    type="checkbox"
                    value="${escapeHtml(service.id)}"
                >

                <span class="service-info">
                    <strong>${escapeHtml(service.name)}</strong>
                    <small>
                        Duração estimada: ${Number(service.duration)} minutos
                    </small>
                </span>

                <strong class="price">${money(service.price)}</strong>
            </label>
        `).join("");

        document.querySelectorAll(".service-check").forEach((input) => {
            input.addEventListener("change", async () => {
                $("total").textContent = money(total());
                if ($("date").value) await loadSlots({ preserveSelection: true });
            });
        });

    } catch (error) {
        $("services").textContent =
            "Não foi possível carregar os serviços. " + error.message;
    }
}

// Carregar horários disponíveis
async function loadSlots({ preserveSelection = false } = {}) {
    const date = $("date").value;
    const previousTime = preserveSelection ? $("time").value : "";

    $("time").innerHTML = `
        <option value="">Carregando horários...</option>
    `;

    if (!date) {
        $("time").innerHTML = `
            <option value="">Primeiro escolha uma data</option>
        `;
        return;
    }

    if (date < today()) {
        $("time").innerHTML = `
            <option value="">Escolha uma data válida</option>
        `;
        $("slotMessage").textContent = "Não é possível selecionar uma data passada.";
        return;
    }

    try {
        const selectedIds = selected().map((service) => service.id);
        const query = new URLSearchParams({ date });
        if (selectedIds.length) query.set("serviceIds", selectedIds.join(","));

        const data = await api(
            `/api/slots?${query.toString()}`
        );

        $("time").innerHTML = `
            <option value="">Selecione um horário</option>
        ` + data.slots.map((time) => `
            <option value="${escapeHtml(time)}">${escapeHtml(time)}</option>
        `).join("");

        if (previousTime && data.slots.includes(previousTime)) {
            $("time").value = previousTime;
        }

        if (previousTime && !data.slots.includes(previousTime)) {
            $("slotMessage").textContent = "A duração dos serviços selecionados alterou a disponibilidade. Escolha outro horário.";
        } else {
            $("slotMessage").textContent = data.slots.length
                ? `${data.slots.length} horário(s) disponível(is).`
                : "Não há horários disponíveis para essa seleção nesse dia. Escolha outra data ou menos serviços.";
        }

    } catch (error) {
        $("time").innerHTML = `
            <option value="">Não foi possível carregar</option>
        `;

        $("slotMessage").textContent = error.message;
    }
}

// Atualizar horários ao mudar a data
$("date").addEventListener("change", loadSlots);

// BOTÃO CONTINUAR — CORRIGIDO
$("continueButton").addEventListener("click", () => {
    const name = $("fullName").value.trim();
    const phone = $("phone").value.replace(/\D/g, "");

    if (name.split(/\s+/).filter(Boolean).length < 2) {
        alert("Por favor, digite seu nome completo.");
        $("fullName").focus();
        return;
    }

    if (phone.length < 10 || phone.length > 11) {
        alert("Digite um celular válido com DDD.");
        $("phone").focus();
        return;
    }

    step(2);
});

// Voltar para os dados do cliente
$("back1").addEventListener("click", () => {
    step(1);
});

// Voltar do pagamento para a etapa de escolha de data e serviços.
$("back2").addEventListener("click", () => {
    step(2);
});

// Finalizar escolha dos serviços e avançar para pagamento
$("finish").addEventListener("click", () => {
    $("scheduleError").textContent = "";

    if (!$("date").value) {
        $("scheduleError").textContent =
            "Escolha o dia do atendimento.";
        return;
    }

    if (!$("time").value) {
        $("scheduleError").textContent =
            "Escolha um horário disponível.";
        return;
    }

    if (!selected().length) {
        $("scheduleError").textContent =
            "Escolha pelo menos um serviço.";
        return;
    }

    booking = {
        name: $("fullName").value.trim(),
        phone: $("phone").value.replace(/\D/g, ""),
        date: $("date").value,
        time: $("time").value,
        services: selected(),
        total: total()
    };

    const formattedDate = new Date(
        booking.date + "T12:00:00"
    ).toLocaleDateString("pt-BR");

    $("summary").innerHTML = `
        <p><strong>Cliente:</strong> ${escapeHtml(booking.name)}</p>
        <p><strong>Celular:</strong> ${escapeHtml(booking.phone)}</p>
        <p><strong>Dia e horário:</strong> ${formattedDate} às ${escapeHtml(booking.time)}</p>
        <p><strong>Serviços:</strong> ${
            booking.services.map((service) =>
                `${escapeHtml(service.name)} (${money(service.price)})`
            ).join(", ")
        }</p>
        <p><strong>Total:</strong> ${money(booking.total)}</p>
    `;

    step(3);
});

// Opções de pagamento
document.querySelectorAll('input[name="payment"]').forEach((radio) => {
    radio.addEventListener("change", () => {
        const selectedPayment = document.querySelector(
            'input[name="payment"]:checked'
        );

        const showPix = selectedPayment?.value === "pix";

        $("pixArea").classList.toggle("hidden", !showPix);

        if (showPix && !qrCreated) {
            if (window.QRCode) {
                new QRCode($("qrcode"), {
                    text: "DEMONSTRACAO PIX - NAO PAGAR - Barbearia Estilo",
                    width: 190,
                    height: 190,
                    colorDark: "#211915",
                    colorLight: "#ffffff"
                });

                qrCreated = true;
            } else {
                $("qrcode").textContent =
                    "QR Code indisponível. Confira a conexão.";
            }
        }
    });
});

// Copiar chave Pix demonstrativa
$("copyPix").addEventListener("click", async () => {
    const input = $("pixKey");

    try {
        await navigator.clipboard.writeText(input.value);
        $("copyMessage").textContent = "Chave fictícia copiada.";

    } catch {
        input.select();

        const copied = document.execCommand("copy");

        $("copyMessage").textContent = copied
            ? "Chave fictícia copiada."
            : "Copie a chave manualmente.";
    }
});

// Confirmar e registrar agendamento na API
$("confirm").addEventListener("click", async () => {
    $("paymentError").textContent = "";

    if (!booking) {
        $("paymentError").textContent =
            "Confira os dados e selecione os serviços novamente.";
        step(1);
        return;
    }

    const payment = document.querySelector(
        'input[name="payment"]:checked'
    )?.value;

    if (!payment) {
        $("paymentError").textContent =
            "Escolha Pix ou pagar depois.";
        return;
    }

    const button = $("confirm");
    button.disabled = true;
    button.textContent = "Registrando...";

    try {
        const result = await api("/api/appointments", {
            method: "POST",
            body: JSON.stringify({
                name: booking.name,
                phone: booking.phone,
                date: booking.date,
                time: booking.time,
                serviceIds: booking.services.map((service) => service.id),
                paymentMethod: payment
            })
        });

        booking.id = result.appointment.id;

        const panels = [
            "customerPanel",
            "schedulePanel",
            "paymentPanel"
        ];

        panels.forEach((id) => $(id).classList.add("hidden"));

        $("successPanel").classList.remove("hidden");

        ["step1", "step2", "step3"].forEach((id) => {
            $(id).classList.remove("active");
            $(id).removeAttribute("aria-current");
        });

        const formattedDate = new Date(
            booking.date + "T12:00:00"
        ).toLocaleDateString("pt-BR");

        const pixMessage = result.pix?.message || "";

        $("successMessage").textContent =
            `Agendamento nº ${booking.id}: ${formattedDate}, às ${booking.time}. ` +
            `Total ${money(booking.total)}. ${pixMessage}`;

        const message =
            `Olá! Meu agendamento na Barbearia Estilo: ` +
            `${formattedDate} às ${booking.time}. ` +
            `Serviços: ${booking.services.map((service) => service.name).join(", ")}. ` +
            `Total: ${money(booking.total)}. Código: ${booking.id}.`;

        const barbershopPhone = window.BARBERSHOP_PHONE || "";

        if (barbershopPhone) {
            $("whatsappLink").href =
                `https://wa.me/${barbershopPhone}?text=${encodeURIComponent(message)}`;

            $("whatsappLink").classList.remove("hidden");
        } else {
            $("whatsappLink").classList.add("hidden");
        }

        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });

    } catch (error) {
        $("paymentError").textContent = error.message;

        if (error.message.toLowerCase().includes("horário")) {
            await loadSlots();
        }

    } finally {
        button.disabled = false;
        button.textContent = "Confirmar agendamento";
    }
});

// Reiniciar o agendamento
$("restart").addEventListener("click", () => {
    ["fullName", "phone", "date"].forEach((id) => {
        $(id).value = "";
    });

    $("date").min = today();

    $("time").innerHTML = `
        <option value="">Primeiro escolha uma data</option>
    `;

    document.querySelectorAll('input[name="payment"]').forEach((input) => {
        input.checked = false;
    });

    document.querySelectorAll(".service-check").forEach((input) => {
        input.checked = false;
    });

    $("pixArea").classList.add("hidden");
    $("qrcode").innerHTML = "";
    $("copyMessage").textContent =
        "Este QR Code não confirma pagamento real.";

    qrCreated = false;
    booking = null;

    $("total").textContent = money(0);
    $("scheduleError").textContent = "";
    $("paymentError").textContent = "";
    $("slotMessage").textContent =
        "Os horários ocupados não aparecem na lista.";

    $("whatsappLink").classList.add("hidden");
    $("whatsappLink").removeAttribute("href");

    step(1);
});

// Carregar configurações públicas da barbearia
api("/api/settings/public")
    .then((settings) => {
        window.BARBERSHOP_PHONE = settings.phone || "";
    })
    .catch(() => {
        window.BARBERSHOP_PHONE = "";
    });

// Carregar serviços ao iniciar
loadServices();
